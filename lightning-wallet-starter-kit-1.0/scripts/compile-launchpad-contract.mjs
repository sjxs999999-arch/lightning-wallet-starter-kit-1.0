import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = process.cwd();
const sourcePath = path.join(root, 'contracts', 'LightningFixedSupplyToken.sol');
const outputPath = path.join(root, 'apps', 'web', 'src', 'launchpad', 'artifacts', 'LightningFixedSupplyToken.json');

function findImports(importPath) {
  const resolved = importPath.startsWith('@')
    ? path.join(root, 'node_modules', importPath)
    : path.join(path.dirname(sourcePath), importPath);
  try { return { contents: fs.readFileSync(resolved, 'utf8') }; }
  catch { return { error: `Import not found: ${importPath}` }; }
}

const input = {
  language: 'Solidity',
  sources: { 'LightningFixedSupplyToken.sol': { content: fs.readFileSync(sourcePath, 'utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (compiled.errors ?? []).filter(item => item.severity === 'error');
if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
const contract = compiled.contracts['LightningFixedSupplyToken.sol'].LightningFixedSupplyToken;
const artifact = {
  contractName: 'LightningFixedSupplyToken',
  compiler: solc.version(),
  evmVersion: 'paris',
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Compiled ${artifact.contractName} with ${artifact.compiler}`);
