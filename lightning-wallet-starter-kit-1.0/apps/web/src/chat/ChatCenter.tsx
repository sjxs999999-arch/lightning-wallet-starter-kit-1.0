import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCheck, CreditCard, Fingerprint, KeyRound, Link2, LockKeyhole, MessageCircle, Plus, RefreshCw, Search, Send, ShieldCheck, UserRoundCheck, WalletCards, X } from 'lucide-react';
import { createChatDevice, decryptSnapshot, encryptSnapshot, fingerprint } from './crypto';
import { chatRelay, RelayError, relaySessionUsable } from './relay';
import { amountValid, canonicalPaymentRequest } from './payment';
import { addressLooksValid, externalHosts, sensitiveMaterialReason } from './safety';
import { loadVault, saveVault } from './storage';
import { acceptPendingDevice, flushEncryptedOutbox, mergeEncryptedInbox, queueEncryptedMessage, refreshContactDevice } from './sync';
import type { ChatChain, ChatContact, ChatSnapshot, EncryptedVault, PaymentRequest } from './types';
import { connectEvm, connectSol, signWalletMessage } from '../wallet-providers/providers';
import type { ConnectedWallet, WalletName } from '../wallet-providers/types';
import './relay-ui.css';

const EMPTY: ChatSnapshot = { version: 1, contacts: [], messages: [], outbox: [], pendingInbox: [], seenMessageIds: [] };
const DEVICE_DIRECTORY_REFRESH_MS = 5 * 60_000;
type RelayState = 'auth-required' | 'connecting' | 'syncing' | 'ready' | 'unavailable';

function short(value: string) { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function normalized(snapshot: ChatSnapshot): ChatSnapshot { return { ...snapshot, outbox: snapshot.outbox ?? [], pendingInbox: snapshot.pendingInbox ?? [], seenMessageIds: snapshot.seenMessageIds ?? [] }; }

export function ChatCenter() {
  const [vault, setVault] = useState<EncryptedVault | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [password, setPassword] = useState('');
  const [activePassword, setActivePassword] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState('');
  const [modal, setModal] = useState<'contact' | 'payment' | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [identityBusy, setIdentityBusy] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState('');
  const [relayState, setRelayState] = useState<RelayState>('auth-required');
  const [relayDetail, setRelayDetail] = useState('尚未用钱包签名验证聊天身份');
  const idle = useRef<number | undefined>(undefined);
  const syncBusy = useRef(false);
  const snapshotRef = useRef<ChatSnapshot | null>(null);
  const passwordRef = useRef('');
  const deviceRefreshAt = useRef(0);
  const unlockEpoch = useRef(0);
  const synchronizeRef = useRef<() => Promise<void>>(async () => undefined);
  const unlocked = snapshot !== null;
  const activeDeviceId = snapshot?.device?.id ?? '';
  const identityBound = Boolean(snapshot?.identity);
  const relayToken = snapshot?.relay?.token ?? '';
  const relayExpiresAt = snapshot?.relay?.expiresAt;

  function expose(next: ChatSnapshot | null) { snapshotRef.current = next; setSnapshot(next); }

  useEffect(() => { loadVault().then(setVault).catch(() => setVault(null)); }, []);
  useEffect(() => { passwordRef.current = activePassword; }, [activePassword]);
  useEffect(() => { synchronizeRef.current = synchronize; });
  useEffect(() => { if (snapshot?.device) void fingerprint(snapshot.device.publicKey).then(setDeviceFingerprint); else setDeviceFingerprint(''); }, [snapshot?.device]);
  useEffect(() => {
    const online = () => setOffline(false), offlineHandler = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineHandler); };
  }, []);
  useEffect(() => {
    if (!unlocked) return;
    const lock = () => { unlockEpoch.current += 1; snapshotRef.current = null; setSnapshot(null); setActivePassword(''); passwordRef.current = ''; setPassword(''); setRelayState('auth-required'); setRelayDetail('聊天保险库已锁定'); };
    const reset = () => { window.clearTimeout(idle.current); idle.current = window.setTimeout(lock, 15 * 60_000); };
    const visibility = () => { if (document.hidden) lock(); };
    ['pointerdown', 'keydown'].forEach(event => window.addEventListener(event, reset, { passive: true }));
    document.addEventListener('visibilitychange', visibility); reset();
    return () => { window.clearTimeout(idle.current); ['pointerdown', 'keydown'].forEach(event => window.removeEventListener(event, reset)); document.removeEventListener('visibilitychange', visibility); };
  }, [unlocked]);
  useEffect(() => {
    if (!activeDeviceId || !activePassword || offline) return;
    if (!identityBound || !relaySessionUsable(relayExpiresAt)) {
      setRelayState('auth-required'); setRelayDetail(identityBound ? '中继会话已过期，请重新用钱包签名验证' : '尚未用钱包签名验证聊天身份'); return;
    }
    void synchronizeRef.current();
    const timer = window.setInterval(() => void synchronizeRef.current(), 12_000);
    return () => window.clearInterval(timer);
  }, [activeDeviceId, identityBound, relayToken, relayExpiresAt, activePassword, offline]);

  async function persist(next: ChatSnapshot, secret = passwordRef.current, expectedEpoch = unlockEpoch.current) {
    if (!secret || !snapshotRef.current || expectedEpoch !== unlockEpoch.current) return;
    const encrypted = await encryptSnapshot(next, secret);
    if (!snapshotRef.current || expectedEpoch !== unlockEpoch.current) return;
    await saveVault(encrypted);
    if (!snapshotRef.current || expectedEpoch !== unlockEpoch.current) return;
    setVault(encrypted); expose(next);
  }

  function relayFailure(cause: unknown) {
    if (cause instanceof RelayError && cause.status === 401) { setRelayState('auth-required'); setRelayDetail('中继会话已过期，请重新用钱包签名验证'); }
    else { setRelayState('unavailable'); setRelayDetail(cause instanceof Error ? cause.message : '中继当前不可用，密文已保留在本地'); }
  }

  async function synchronize() {
    if (syncBusy.current || offline) return;
    const current = snapshotRef.current, secret = passwordRef.current, epoch = unlockEpoch.current;
    if (!current?.device || !current.relay || !relaySessionUsable(current.relay.expiresAt) || !secret) return;
    syncBusy.current = true; setRelayState('syncing'); setRelayDetail('正在投递待发密文并检查新消息…');
    try {
      let next: ChatSnapshot = current;
      const outboxContacts = new Set((next.outbox ?? []).map(item => item.contactId));
      const fullRefresh = Date.now() - deviceRefreshAt.current > DEVICE_DIRECTORY_REFRESH_MS;
      const contacts = [] as ChatContact[];
      let refreshCount = 0;
      for (const item of next.contacts) {
        const shouldRefresh = item.chain !== 'TRON' && (outboxContacts.has(item.id) || (fullRefresh && refreshCount < 50));
        if (!shouldRefresh) { contacts.push(item); continue; }
        refreshCount += 1;
        const devices = await chatRelay.devices(item.chain, item.address, current.relay.token);
        if (!devices.length && outboxContacts.has(item.id)) throw new RelayError('对方消息设备已不可用，待发密文未被投递');
        contacts.push(await refreshContactDevice(item, devices));
      }
      next = { ...next, contacts };
      if (fullRefresh) deviceRefreshAt.current = Date.now();
      if (!snapshotRef.current || epoch !== unlockEpoch.current) return;
      await persist(next, secret, epoch);
      next = await flushEncryptedOutbox(next, envelope => chatRelay.send(current.relay!.token, envelope));
      if (!snapshotRef.current || epoch !== unlockEpoch.current) return;
      await persist(next, secret, epoch);
      const inbox = await chatRelay.poll(current.relay.token, current.device.id, next.inboxCursor);
      const merged = await mergeEncryptedInbox(next, inbox.items);
      next = normalized({ ...merged.snapshot, inboxCursor: inbox.cursor || next.inboxCursor });
      if (!snapshotRef.current || epoch !== unlockEpoch.current) return;
      await persist(next, secret, epoch);
      if (!snapshotRef.current || epoch !== unlockEpoch.current) return;
      if (merged.ackIds.length) await chatRelay.ack(current.relay.token, current.device.id, merged.ackIds);
      setRelayState('ready'); setRelayDetail(`中继已连接 · ${next.outbox?.length ?? 0} 条密文待发`);
    } catch (cause) { relayFailure(cause); }
    finally { syncBusy.current = false; }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const decrypted = vault ? normalized(await decryptSnapshot(vault, password)) : EMPTY;
      const next = decrypted.device ? decrypted : { ...decrypted, device: createChatDevice() };
      if (!vault || !decrypted.device) { const encrypted = await encryptSnapshot(next, password); await saveVault(encrypted); setVault(encrypted); }
      unlockEpoch.current += 1; passwordRef.current = password; setActivePassword(password); expose(next); setPassword(''); setSelected(next.contacts[0]?.id ?? '');
      if (next.identity && relaySessionUsable(next.relay?.expiresAt)) { setRelayState('connecting'); setRelayDetail('正在连接密文中继…'); }
      else { setRelayState('auth-required'); setRelayDetail(next.identity ? '中继会话已过期，请重新签名验证' : '尚未用钱包签名验证聊天身份'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开聊天保险库'); }
  }

  const contacts = useMemo(() => (snapshot?.contacts ?? []).filter(contact => `${contact.name} ${contact.address}`.toLowerCase().includes(search.toLowerCase())), [snapshot, search]);
  const contact = snapshot?.contacts.find(item => item.id === selected) ?? null;
  const messages = snapshot?.messages.filter(message => message.contactId === selected) ?? [];
  const canCompose = Boolean(contact && snapshot?.identity && contact.devicePublicKey && !contact.deviceChanged && contact.trust !== 'blocked');

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!snapshot) return;
    const data = new FormData(event.currentTarget), name = String(data.get('name') ?? '').trim(), chain = String(data.get('chain')) as ChatChain, address = String(data.get('address') ?? '').trim();
    if (!name || !addressLooksValid(chain, address)) { setError('请输入有效的联系人名称和钱包地址'); return; }
    if (snapshot.contacts.some(item => item.chain === chain && item.address.toLowerCase() === address.toLowerCase())) { setError('该钱包地址已在联系人中'); return; }
    setContactBusy(true); setError('');
    let devices = [] as Awaited<ReturnType<typeof chatRelay.devices>>;
    try { devices = await chatRelay.devices(chain, address, relaySessionUsable(snapshot.relay?.expiresAt) ? snapshot.relay?.token : undefined); }
    catch (cause) { relayFailure(cause); }
    const device = devices[0];
    const nextContact: ChatContact = { id: crypto.randomUUID(), conversationId: crypto.randomUUID(), name, chain, address, trust: 'unknown', fingerprint: device ? await fingerprint(device.publicKey) : '等待对方发布设备公钥', deviceId: device?.deviceId, devicePublicKey: device?.publicKey, deviceUpdatedAt: device?.updatedAt };
    await persist({ ...snapshot, contacts: [...snapshot.contacts, nextContact] }); setSelected(nextContact.id); setModal(null); setContactBusy(false);
  }

  async function queueAndMaybeSend(next: ChatSnapshot) {
    await persist(next);
    if (!offline && relaySessionUsable(next.relay?.expiresAt)) window.setTimeout(() => void synchronize(), 0);
    else if (!next.relay || !relaySessionUsable(next.relay.expiresAt)) { setRelayState('auth-required'); setRelayDetail('消息已加密排队；重新用钱包签名后才能投递'); }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault(); if (!snapshot || !contact || !canCompose) return;
    const text = composer.trim(), reason = sensitiveMaterialReason(text);
    if (!text) return; if (reason) { setError(reason); return; }
    const links = externalHosts(text); if (links.length && !window.confirm(`消息包含外部链接：${links.join(', ')}。确认以纯文本发送吗？`)) return;
    try { const next = await queueEncryptedMessage(snapshot, contact, { kind: 'text', text, createdAt: new Date().toISOString() }); await queueAndMaybeSend(next); setComposer(''); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建加密消息'); }
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!snapshot?.identity || !contact || !canCompose) return;
    const data = new FormData(event.currentTarget), amount = String(data.get('amount') ?? ''), asset = String(data.get('asset') ?? '').trim(), memo = String(data.get('memo') ?? '').trim();
    const sensitive = sensitiveMaterialReason(memo);
    if (sensitive) { setError(sensitive); return; }
    if (!amountValid(amount) || !/^[A-Za-z0-9:._-]{1,80}$/.test(asset)) { setError('请输入有效资产和大于 0 的金额'); return; }
    if (!connected || connected.family !== snapshot.identity.chain || connected.address.toLowerCase() !== snapshot.identity.address.toLowerCase()) { setError('创建付款请求前，请在右侧重新连接并核对当前收款钱包'); return; }
    const unsigned = { requestId: crypto.randomUUID(), chain: snapshot.identity.chain, chainId: snapshot.identity.chain === 'EVM' ? '11155111' : snapshot.identity.chain === 'SOL' ? 'solana:devnet' : 'tron:nile', asset, amount, payTo: snapshot.identity.address, requesterAddress: snapshot.identity.address, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), memo, status: 'pending' as const };
    try { const payment: PaymentRequest = { ...unsigned, signature: await signWalletMessage(connected, canonicalPaymentRequest(unsigned)) }; const next = await queueEncryptedMessage(snapshot, contact, { kind: 'payment-request', text: `${amount} ${asset}`, createdAt: new Date().toISOString(), payment }); await queueAndMaybeSend(next); setModal(null); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建加密付款请求'); }
  }

  async function retryMessage(messageId: string) {
    if (!snapshot) return;
    const next = { ...snapshot, messages: snapshot.messages.map(message => message.id === messageId ? { ...message, state: 'queued' as const, error: undefined } : message) };
    await persist(next); await synchronize();
  }

  async function updateTrust(trust: ChatContact['trust']) {
    if (!snapshot || !contact) return;
    await persist({ ...snapshot, contacts: snapshot.contacts.map(item => item.id === contact.id ? { ...item, trust } : item) });
  }

  async function acceptKeyChange() {
    if (!snapshot || !contact?.pendingDevicePublicKey) return;
    const nextFingerprint = await fingerprint(contact.pendingDevicePublicKey);
    if (!window.confirm(`请先通过其他渠道核对新安全指纹：\n${nextFingerprint}\n\n确认后联系人信任状态会重置。`)) return;
    let next = await acceptPendingDevice(snapshot, contact.id);
    const held = (next.pendingInbox ?? []).filter(item => item.sender.chain === contact.chain && item.sender.address.toLowerCase() === contact.address.toLowerCase());
    next = { ...next, pendingInbox: (next.pendingInbox ?? []).filter(item => !held.includes(item)) };
    const merged = await mergeEncryptedInbox(next, held); next = merged.snapshot;
    await persist(next);
    if (merged.ackIds.length && next.device && next.relay && relaySessionUsable(next.relay.expiresAt)) await chatRelay.ack(next.relay.token, next.device.id, merged.ackIds).catch(() => undefined);
    setError('');
  }

  async function connectIdentity(name: WalletName, family: 'EVM' | 'SOL') {
    setIdentityBusy(name); setError('');
    try { setConnected(family === 'EVM' ? await connectEvm(name, import.meta.env.VITE_WALLETCONNECT_PROJECT_ID) : await connectSol(name)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '钱包连接失败'); }
    finally { setIdentityBusy(''); }
  }

  async function bindIdentity() {
    if (!snapshot?.device || !connected) return;
    setIdentityBusy('bind'); setRelayState('connecting'); setRelayDetail('正在向中继申请一次性身份挑战…'); setError('');
    try {
      const request = { chain: connected.family as ChatChain, address: connected.address, deviceId: snapshot.device.id, devicePublicKey: snapshot.device.publicKey };
      const challenge = await chatRelay.challenge(request);
      const signature = await signWalletMessage(connected, challenge.message);
      const auth = await chatRelay.verify(challenge.challengeId, signature);
      if (auth.deviceId !== snapshot.device.id || auth.chain !== connected.family || auth.address.toLowerCase() !== connected.address.toLowerCase()) throw new Error('中继验证结果与当前钱包或设备不匹配');
      await chatRelay.registerDevice(auth.token, { chain: connected.family as ChatChain, address: connected.address }, snapshot.device);
      const next: ChatSnapshot = { ...snapshot, identity: { chain: connected.family as ChatChain, address: connected.address, walletName: connected.name, network: connected.network, verifiedAt: new Date().toISOString(), signature }, relay: { token: auth.token, expiresAt: auth.expiresAt } };
      await persist(next); setRelayState('ready'); setRelayDetail('钱包身份已由中继验证，设备公钥已发布'); window.setTimeout(() => void synchronize(), 0);
    } catch (cause) { relayFailure(cause); setError(cause instanceof Error ? cause.message : '身份绑定失败'); }
    finally { setIdentityBusy(''); }
  }

  if (vault === undefined) return <div className="route-loading">正在读取本地加密聊天…</div>;
  if (!snapshot) return <><div className="page-head"><div><p className="eyebrow">WALLET IDENTITY</p><h1>闪电通讯</h1><p>钱包地址验证身份，消息内容只在本地加密保存。</p></div></div><section className="panel chat-lock"><div className="chat-lock-icon"><LockKeyhole/></div><p className="eyebrow">LOCAL E2EE VAULT</p><h2>{vault ? '解锁聊天保险库' : '创建聊天保险库'}</h2><p>{vault ? '输入本地密码解密联系人和消息。切到后台或闲置 15 分钟会自动锁定。' : '创建仅用于本设备聊天数据的密码。丢失密码后历史消息无法恢复。'}</p><form onSubmit={unlock}><input type="password" minLength={12} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 12 个字符" autoComplete="current-password"/><button disabled={password.length < 12}><KeyRound size={16}/>{vault ? '本地解锁' : '创建并启用'}</button></form>{error && <div className="chat-error"><AlertTriangle size={15}/>{error}</div>}<div className="chat-security-row"><ShieldCheck size={15}/>PBKDF2 310,000 次 + AES-256-GCM · 正文不写入 localStorage · 中继只接收密文</div></section></>;

  const relayClass = offline ? 'offline' : relayState;
  return <><div className="page-head chat-heading"><div><p className="eyebrow">WALLET-TO-WALLET</p><h1>闪电通讯</h1><p>地址是可验证账户，不等同于真实身份；昵称与信任状态仅保存在本设备。</p></div><button onClick={() => { snapshotRef.current = null; setSnapshot(null); setActivePassword(''); passwordRef.current = ''; }}><LockKeyhole size={16}/>锁定</button></div><div className={`chat-relay-status ${relayClass}`}><span className="chat-relay-dot"/><div><b>{offline ? '当前离线' : relayState === 'ready' ? '密文中继已连接' : relayState === 'syncing' ? '正在同步密文' : relayState === 'unavailable' ? '密文中继不可用' : relayState === 'connecting' ? '正在验证中继' : '需要钱包身份验证'}</b><small>{offline ? '新消息仍会在本地加密排队，联网后重试' : relayDetail}</small></div><code>{chatRelay.base}</code>{!offline && relaySessionUsable(snapshot.relay?.expiresAt) && <button onClick={() => void synchronize()} disabled={syncBusy.current}><RefreshCw size={14}/>立即同步</button>}</div>{error && <div className="chat-error"><AlertTriangle size={15}/>{error}<button onClick={() => setError('')}><X size={14}/></button></div>}<section className="chat-shell panel"><aside className="chat-conversations"><div className="chat-list-head"><div><b>会话</b><small>{snapshot.outbox?.length ? `${snapshot.outbox.length} 条密文待发` : `${snapshot.contacts.length} 个联系人`}</small></div><button onClick={() => setModal('contact')} title="添加联系人"><Plus size={17}/></button></div><button className={`chat-identity-chip ${snapshot.identity && relaySessionUsable(snapshot.relay?.expiresAt) ? 'verified' : ''}`} onClick={() => setSelected('')}><Fingerprint size={15}/><span>{snapshot.identity ? `${short(snapshot.identity.address)} · ${relaySessionUsable(snapshot.relay?.expiresAt) ? '已验证' : '需重新验证'}` : '验证钱包聊天身份'}</span></button><label className="chat-search"><Search size={14}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索地址或昵称"/></label><div className="chat-contact-list">{contacts.map(item => { const last = snapshot.messages.filter(message => message.contactId === item.id).at(-1); return <button className={item.id === selected ? 'active' : ''} key={item.id} onClick={() => setSelected(item.id)}><span className="chat-avatar">{initials(item.name)}</span><div><b>{item.name}</b><small>{item.deviceChanged ? '设备密钥已变化' : last?.kind === 'payment-request' ? '付款请求' : last?.text ?? (item.devicePublicKey ? short(item.address) : '尚无消息设备')}</small></div>{item.deviceChanged ? <AlertTriangle size={14}/> : item.trust === 'trusted' && <UserRoundCheck size={14}/>}</button>; })}{!contacts.length && <div className="chat-empty"><MessageCircle/><b>还没有联系人</b><span>添加钱包地址后开始安全会话</span></div>}</div></aside><main className="chat-thread">{contact ? <><div className="chat-thread-head"><span className="chat-avatar">{initials(contact.name)}</span><div><b>{contact.name}</b><small>{contact.chain} · {short(contact.address)}</small></div><span className={`chat-trust ${contact.trust}`}>{contact.trust === 'trusted' ? '已信任' : contact.trust === 'blocked' ? '已阻止' : '待验证'}</span></div>{contact.deviceChanged && <div className="chat-key-warning"><AlertTriangle size={15}/><div><b>对方设备密钥已变化，发送和待发投递均已暂停。</b><small>通过其他渠道核对新指纹后才能继续。</small></div><button onClick={() => void acceptKeyChange()}>核对并接受新密钥</button></div>}{!contact.devicePublicKey && <div className="chat-key-warning neutral"><KeyRound size={15}/>尚未从中继找到对方设备公钥。无法端到端加密，因此不会发送任何消息。</div>}{!snapshot.identity && <div className="chat-key-warning neutral"><Fingerprint size={15}/>请先验证自己的钱包身份，未经验证的地址不能使用中继。</div>}<div className="chat-messages">{messages.map(message => <article className={`chat-bubble ${message.direction} ${message.state}`} key={message.id}>{message.kind === 'payment-request' && message.payment ? <div className="payment-card"><CreditCard size={18}/><span>付款请求</span><strong>{message.payment.amount} {message.payment.asset}</strong><small>收款：{short(message.payment.payTo)}</small><small>{message.payment.memo || '无备注'} · {new Date(message.payment.expiresAt) > new Date() ? '有效期内' : '已过期'}</small>{message.direction === 'incoming' && <button onClick={() => window.location.assign('/batch-transfer')}>进入模拟与签名流程</button>}</div> : <p>{message.text}</p>}<footer><time>{formatTime(message.createdAt)}</time>{message.direction === 'outgoing' && (message.state === 'sent' ? <><span>已由中继接收</span><CheckCheck size={13}/></> : message.state === 'failed' ? <><span>{message.error ?? '投递失败'}</span><button onClick={() => void retryMessage(message.id)}><RefreshCw size={11}/>重试</button></> : <><span>密文待发</span><Check size={13}/></>)}</footer></article>)}{!messages.length && <div className="chat-empty thread"><Fingerprint/><b>{contact.devicePublicKey ? '先核对安全指纹' : '等待对方发布消息设备'}</b><span>{contact.fingerprint}</span></div>}</div><form className="chat-composer" onSubmit={sendMessage}><button type="button" title="创建付款请求" onClick={() => setModal('payment')} disabled={!canCompose}><CreditCard size={18}/></button><textarea value={composer} onChange={event => setComposer(event.target.value)} placeholder={contact.trust === 'blocked' ? '该联系人已被阻止' : contact.deviceChanged ? '设备密钥变化，发送已暂停' : !contact.devicePublicKey ? '没有设备公钥，无法加密发送' : !snapshot.identity ? '请先验证钱包聊天身份' : '输入消息；私钥和助记词会被阻止'} disabled={!canCompose} rows={1}/><button className="send" disabled={!composer.trim() || !canCompose}><Send size={17}/></button></form></> : <div className="chat-empty thread"><MessageCircle/><b>选择一个安全会话</b><span>消息加密密钥独立于链上交易私钥</span></div>}</main><aside className="chat-details">{contact ? <><p className="eyebrow">CONTACT SECURITY</p><span className="chat-avatar large">{initials(contact.name)}</span><h3>{contact.name}</h3><code>{contact.address}</code><div className="chat-detail-block"><span>消息设备</span><b><ShieldCheck size={14}/>{contact.devicePublicKey ? '已从中继取得绑定公钥' : '尚未发布设备公钥'}</b><small>地址所有权验证不代表真人身份认证</small></div><div className="chat-detail-block"><span>安全指纹</span><b className="fingerprint"><Fingerprint size={14}/>{contact.fingerprint}</b><small>建议通过其他渠道逐段核对</small></div><div className="chat-trust-actions"><button onClick={() => void updateTrust('trusted')} disabled={!contact.devicePublicKey || contact.deviceChanged}><UserRoundCheck size={15}/>标记已核对</button><button className="danger" onClick={() => void updateTrust(contact.trust === 'blocked' ? 'unknown' : 'blocked')}>{contact.trust === 'blocked' ? '解除阻止' : '阻止联系人'}</button></div></> : <><p className="eyebrow">DEVICE IDENTITY</p><Fingerprint size={34}/><h3>本设备消息密钥</h3><code>{deviceFingerprint || '正在生成…'}</code><p>链上钱包只用于向中继证明地址所有权；消息使用独立 X25519 设备密钥。</p>{snapshot.identity && <div className="chat-detail-block"><span>最近验证钱包</span><b><UserRoundCheck size={14}/>{snapshot.identity.walletName}</b><code>{short(snapshot.identity.address)}</code><small>{snapshot.identity.network} · {new Date(snapshot.identity.verifiedAt).toLocaleString()}</small></div>}<div className="chat-identity-actions">{connected ? <><div className="chat-detail-block"><span>待验证钱包</span><b>{connected.name}</b><code>{short(connected.address)}</code></div><button disabled={Boolean(identityBusy)} onClick={() => void bindIdentity()}><KeyRound size={15}/>{identityBusy === 'bind' ? '等待钱包签名…' : '获取服务端挑战并签名'}</button></> : <><button disabled={Boolean(identityBusy)} onClick={() => void connectIdentity('MetaMask', 'EVM')}>{snapshot.identity ? '用 MetaMask 重新验证' : '连接 MetaMask'}</button><button disabled={Boolean(identityBusy)} onClick={() => void connectIdentity('Phantom', 'SOL')}>{snapshot.identity ? '用 Phantom 重新验证' : '连接 Phantom'}</button></>}</div><div className="chat-safety-note"><ShieldCheck size={15}/>签名只验证身份，不授权交易、代币批准或资产转移。</div></>}</aside></section>{modal === 'contact' && <Modal title="添加钱包联系人" onClose={() => setModal(null)}><form className="chat-modal-form" onSubmit={addContact}><label>本地昵称<input name="name" required maxLength={50} placeholder="例如：Lina"/></label><label>网络<select name="chain"><option value="EVM">EVM</option><option value="SOL">Solana</option><option value="TRON">TRON</option></select></label><label>钱包地址<input name="address" required placeholder="输入完整地址"/></label><div className="chat-safety-note"><ShieldCheck size={15}/>将从中继查询该地址绑定的设备公钥；找不到公钥时不会发送消息。</div><button disabled={contactBusy}><Plus size={16}/>{contactBusy ? '查询设备目录…' : '添加联系人'}</button></form></Modal>}{modal === 'payment' && contact && <Modal title="创建付款请求" onClose={() => setModal(null)}><form className="chat-modal-form" onSubmit={createPayment}><label>资产<input name="asset" defaultValue={contact.chain === 'SOL' ? 'USDC' : contact.chain === 'TRON' ? 'USDT' : 'ETH'} required maxLength={20}/></label><label>金额<input name="amount" inputMode="decimal" required placeholder="0.00"/></label><label>备注<input name="memo" maxLength={120} placeholder="用途（可选）"/></label><div className="chat-safety-note"><WalletCards size={15}/>请求收款地址固定为已验证的本钱包。请求不会自动转账，付款方仍需模拟并显式签名。</div><button><Link2 size={16}/>加密并排队发送</button></form></Modal>}</>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="chat-modal-layer"><button className="chat-modal-scrim" aria-label="关闭" onClick={onClose}/><section role="dialog" aria-modal="true" aria-label={title} className="chat-modal"><button className="chat-modal-close" onClick={onClose}><X size={17}/></button><p className="eyebrow">ENCRYPTED ACTION</p><h2>{title}</h2>{children}</section></div>;
}
