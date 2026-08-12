import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ackChatEnvelopes,
  chatAuthorizationClaims,
  ChatError,
  type ChatStore,
  createChatChallenge,
  listChatDevices,
  pollChatEnvelopes,
  registerChatDevice,
  revokeChatDevice,
  sendChatEnvelope,
  signChatToken,
  verifyChatChallenge,
} from './chat.js';

function safeChatError(reply: FastifyReply, error: unknown) {
  if (error instanceof ChatError) return reply.status(error.status).send({ error: error.code, message: 'Chat request could not be completed' });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: 'CHAT_REQUEST_INVALID', message: 'Chat request fields are invalid' });
  return reply.status(503).send({ error: 'CHAT_RELAY_UNAVAILABLE', message: 'Encrypted chat relay is temporarily unavailable' });
}

function claims(request: FastifyRequest, secret: string) {
  return chatAuthorizationClaims(request.headers.authorization, secret);
}

export function registerChatRoutes(app: FastifyInstance, db: ChatStore, secret: string) {
  app.post('/api/v1/chat/auth/challenge', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    try { return { data: await createChatChallenge(db, request.body) }; }
    catch (error) { return safeChatError(reply, error); }
  });

  app.post('/api/v1/chat/auth/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const identity = await verifyChatChallenge(db, request.body);
      const session = signChatToken(identity, secret);
      return { data: { token: session.token, expiresAt: session.expiresAt, chain: identity.chain, address: identity.address, deviceId: identity.deviceId } };
    } catch (error) { return safeChatError(reply, error); }
  });

  app.put('/api/v1/chat/devices/:deviceId', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const params = request.params as { deviceId?: unknown };
      return { data: await registerChatDevice(db, claims(request, secret), params.deviceId, request.body) };
    } catch (error) { return safeChatError(reply, error); }
  });

  app.delete('/api/v1/chat/devices/:deviceId', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const params = request.params as { deviceId?: unknown };
      return { data: await revokeChatDevice(db, claims(request, secret), params.deviceId) };
    } catch (error) { return safeChatError(reply, error); }
  });

  app.get('/api/v1/chat/devices', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    try { return { data: await listChatDevices(db, claims(request, secret), request.query) }; }
    catch (error) { return safeChatError(reply, error); }
  });

  app.post('/api/v1/chat/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    try { return { data: await sendChatEnvelope(db, claims(request, secret), request.body) }; }
    catch (error) { return safeChatError(reply, error); }
  });

  app.get('/api/v1/chat/messages', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    try { return { data: await pollChatEnvelopes(db, claims(request, secret), request.query) }; }
    catch (error) { return safeChatError(reply, error); }
  });

  app.post('/api/v1/chat/messages/ack', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    try { return { data: await ackChatEnvelopes(db, claims(request, secret), request.body) }; }
    catch (error) { return safeChatError(reply, error); }
  });
}
