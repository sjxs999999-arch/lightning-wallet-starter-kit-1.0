import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import wrapper from 'solc/wrapper.js';

const root = process.cwd();
const version = '0.8.30+commit.343938e7';
const expectedSha256 = '59bb6f8f91793045bce0cc5bb9c6547a7425612b1ac66fd666f9ef1dad75ea46';
const compilerUrl = `https://raw.githubusercontent.com/tronprotocol/solc-bin/master/wasm/soljson-v${version}.js`;
const sourcePath = path.join(root, 'contracts', 'LightningFixedSupplyToken.sol');
const outputPath = path.join(root, 'apps', 'web', 'src', 'launchpad', 'artifacts', 'LightningFixedSupplyToken.tron.json');

function findImports(importPath) {
  const resolved = importPath.startsWith('@') ? path.join(root, 'node_modules', importPath) : path.join(path.dirname(sourcePath), importPath);
  try { return { contents: fs.readFileSync(resolved, 'utf8') }; }
  catch { return { error: `Import not found: ${importPath}` }; }
}

const response = await fetch(compilerUrl);
if (!response.ok) throw new Error(`TRON compiler download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (actualSha256 !== expectedSha256) throw new Error(`TRON compiler checksum mismatch: ${actualSha256}`);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lightning-tron-solc-'));
const compilerPath = path.join(temporaryDirectory, `soljson-v${version}.cjs`);
try {
  fs.writeFileSync(compilerPath, bytes);
  const require = createRequire(import.meta.url);
  const compiler = wrapper(require(compilerPath));
  if (!compiler.version().startsWith(version)) throw new Error(`Unexpected TRON compiler version: ${compiler.version()}`);
  const input = {
    language: 'Solidity',
    sources: { 'LightningFixedSupplyToken.sol': { content: fs.readFileSync(sourcePath, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', metadata: { bytecodeHash: 'none' },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const compiled = JSON.parse(compiler.compile(JSON.stringify(input), { import: findImports }));
  const errors = (compiled.errors ?? []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  const contract = compiled.contracts['LightningFixedSupplyToken.sol'].LightningFixedSupplyToken;
  const artifact = {
    contractName: 'LightningFixedSupplyToken', compiler: compiler.version(), compilerFamily: 'tronprotocol/solidity',
    compilerSha256: actualSha256, evmVersion: 'paris', abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Compiled ${artifact.contractName} with TRON Solidity ${artifact.compiler}`);
} finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
