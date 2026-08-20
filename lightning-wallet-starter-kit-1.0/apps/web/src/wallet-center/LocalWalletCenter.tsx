import { useCallback, useEffect, useRef, useState } from 'react';
import '../wallet-center.css';
import { BookUser, Copy, Download, Eye, KeyRound, LockKeyhole, Plus, QrCode, Send, ShieldCheck, Trash2, Upload, WalletCards } from 'lucide-react';
import QRCode from 'qrcode';
import { useNavigate } from 'react-router-dom';
import { decryptValue } from '../batch-wallet/crypto';
import { deriveWallet, newMnemonic } from '../batch-wallet/engine';
import { MigrationPanel } from '../batch-wallet/MigrationPanel';
import type { BatchChain } from '../batch-wallet/types';
import { importEvmKeystore, importPrivateWallet } from './import';
import { LocalTransferPanel } from './LocalTransferPanel';
import {
  createVault,
  encryptVaultWallet,
  loadVault,
  parseVault,
  saveVault,
  unlockVault,
  type VaultEnvelope,
  type VaultWallet,
  type WalletOrigin,
} from './vault';
import {
  loadAddressBook,
  loadCustomTokens,
  makeAddressBookEntry,
  makeCustomToken,
  saveAddressBook,
  saveCustomTokens,
  type AddressBookEntry,
  type CustomToken,
} from './public-metadata';

type ImportMode = 'create' | 'mnemonic' | 'private-key' | 'keystore';
const AUTO_LOCK_MS = 15 * 60_000;

function initialVault() {
  try { return { vault: loadVault(), error: '' }; }
  catch (cause) { return { vault: null, error: cause instanceof Error ? cause.message : '本地保险库无法读取' }; }
}

function explorerUrl(wallet: VaultWallet) {
  if (wallet.chain === 'SOL') return `https://explorer.solana.com/address/${encodeURIComponent(wallet.address)}`;
  if (wallet.chain === 'TRON') return `https://tronscan.org/#/address/${encodeURIComponent(wallet.address)}`;
  return `https://etherscan.io/address/${encodeURIComponent(wallet.address)}`;
}

function downloadEncryptedVault(vault: VaultEnvelope) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lightning-local-vault-${Date.now()}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LocalWalletCenter() {
  const [initial] = useState(initialVault);
  const [vault, setVault] = useState<VaultEnvelope | null>(initial.vault);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(vault?.wallets[0]?.id ?? null);
  const [chain, setChain] = useState<BatchChain>('EVM');
  const [mode, setMode] = useState<ImportMode>('create');
  const [busy, setBusy] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState('');
  const [addressBook, setAddressBook] = useState<AddressBookEntry[]>(loadAddressBook);
  const [tokens, setTokens] = useState<CustomToken[]>(loadCustomTokens);
  const setupPasswordRef = useRef<HTMLInputElement>(null);
  const setupConfirmRef = useRef<HTMLInputElement>(null);
  const unlockPasswordRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const indexRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLTextAreaElement>(null);
  const keystoreRef = useRef<HTMLInputElement>(null);
  const keystorePasswordRef = useRef<HTMLInputElement>(null);
  const contactLabelRef = useRef<HTMLInputElement>(null);
  const contactAddressRef = useRef<HTMLInputElement>(null);
  const tokenSymbolRef = useRef<HTMLInputElement>(null);
  const tokenAddressRef = useRef<HTMLInputElement>(null);
  const tokenDecimalsRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const selected = vault?.wallets.find(wallet => wallet.id === selectedId) ?? vault?.wallets[0];

  const lock = useCallback(() => {
    setVaultKey(null);
    setSensitive(false);
    if (unlockPasswordRef.current) unlockPasswordRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!vaultKey) return;
    let timer = window.setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => { window.clearTimeout(timer);timer = window.setTimeout(lock, AUTO_LOCK_MS); };
    const pageHide = () => lock();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [lock, vaultKey]);

  useEffect(() => {
    let active = true;
    setQr('');
    if (!selected) return;
    QRCode.toDataURL(selected.address, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then(value => { if (active) setQr(value); })
      .catch(() => { if (active) setError('收款二维码生成失败，请复制地址'); });
    return () => { active = false; };
  }, [selected]);

  function commitVault(next: VaultEnvelope) {
    saveVault(next);
    setVault(next);
  }

  function clearSecretInputs() {
    if (secretRef.current) secretRef.current.value = '';
    if (keystorePasswordRef.current) keystorePasswordRef.current.value = '';
    if (keystoreRef.current) keystoreRef.current.value = '';
  }

  async function setupVault() {
    const password = setupPasswordRef.current?.value ?? '';
    const confirmation = setupConfirmRef.current?.value ?? '';
    if (password !== confirmation) { setError('两次输入的保险库密码不一致');return; }
    setBusy(true);setError('');setNotice('');
    try {
      const created = await createVault(password);
      saveVault(created.vault);
      setVault(created.vault);setVaultKey(created.key);setNotice('本地加密保险库已创建；密码没有保存或上传');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保险库创建失败'); }
    finally {
      if (setupPasswordRef.current) setupPasswordRef.current.value = '';
      if (setupConfirmRef.current) setupConfirmRef.current.value = '';
      setBusy(false);
    }
  }

  async function unlock() {
    if (!vault) return;
    const password = unlockPasswordRef.current?.value ?? '';
    setBusy(true);setError('');setNotice('');
    try {
      const key = await unlockVault(vault, password);
      setVaultKey(key);setNotice('保险库已解锁；15 分钟无操作会自动锁定');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保险库解锁失败'); }
    finally { if (unlockPasswordRef.current) unlockPasswordRef.current.value = '';setBusy(false); }
  }

  async function addWallet() {
    if (!vault || !vaultKey || sensitive) return;
    const name = (nameRef.current?.value ?? '').trim() || `${chain}-Wallet-${vault.wallets.length + 1}`;
    const index = Number(indexRef.current?.value || 0);
    if (!Number.isInteger(index) || index < 0 || index > 999) { setError('账户索引必须为 0–999');return; }
    setBusy(true);setError('');setNotice('');
    let mnemonic = '';
    let privateKey = '';
    try {
      let material: { address: string; publicKey: string; privateKey: string; path?: string; index?: number };
      let origin: WalletOrigin;
      if (mode === 'create' || mode === 'mnemonic') {
        mnemonic = mode === 'create' ? newMnemonic() : (secretRef.current?.value ?? '').trim().replace(/\s+/g, ' ');
        const derived = await deriveWallet(chain, mnemonic, index);
        material = derived;privateKey = derived.privateKey;origin = mode === 'create' ? 'created' : 'mnemonic';
      } else if (mode === 'private-key') {
        material = importPrivateWallet(chain, secretRef.current?.value ?? '');privateKey = material.privateKey;origin = 'private-key';
      } else {
        if (chain !== 'EVM') throw new Error('Keystore 导入仅适用于 EVM 钱包');
        const file = keystoreRef.current?.files?.[0];
        if (!file) throw new Error('请选择 Keystore JSON 文件');
        material = await importEvmKeystore(await file.text(), keystorePasswordRef.current?.value ?? '');
        privateKey = material.privateKey;origin = 'keystore';
      }
      if (vault.wallets.some(wallet => wallet.chain === chain && wallet.address === material.address)) throw new Error('该钱包地址已存在于本地保险库');
      const record = await encryptVaultWallet(vaultKey, {
        id: crypto.randomUUID(), name, chain, address: material.address, publicKey: material.publicKey,
        path: material.path ?? `imported:${chain}`, index: material.index ?? 0, origin, createdAt: new Date().toISOString(),
      }, privateKey, mnemonic || undefined);
      const next = { ...vault, wallets: [...vault.wallets, record] };
      commitVault(next);setSelectedId(record.id);setNotice(`${record.name} 已加密保存到本机；密钥上传 0`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '钱包创建或导入失败'); }
    finally {
      mnemonic = '';privateKey = '';clearSecretInputs();setBusy(false);
    }
  }

  async function deriveNextAccount() {
    if (!vault || !vaultKey || !selected?.hasMnemonic || sensitive) return;
    setBusy(true);setError('');setNotice('');
    let mnemonic = '';
    let privateKey = '';
    try {
      mnemonic = await decryptValue(vaultKey, selected.encryptedMnemonic);
      let index = selected.index + 1;
      let derived = await deriveWallet(selected.chain, mnemonic, index);
      while (vault.wallets.some(wallet => wallet.chain === selected.chain && wallet.address === derived.address) && index < 999) {
        derived.privateKey = '';derived.mnemonic = '';index += 1;derived = await deriveWallet(selected.chain, mnemonic, index);
      }
      if (vault.wallets.some(wallet => wallet.chain === selected.chain && wallet.address === derived.address)) throw new Error('没有可用的派生账户索引');
      privateKey = derived.privateKey;
      const record = await encryptVaultWallet(vaultKey, {
        id: crypto.randomUUID(), name: `${selected.name} #${index}`, chain: selected.chain, address: derived.address,
        publicKey: derived.publicKey, path: derived.path, index, origin: 'derived', createdAt: new Date().toISOString(),
      }, privateKey, mnemonic);
      const next = { ...vault, wallets: [...vault.wallets, record] };
      commitVault(next);setSelectedId(record.id);setNotice('新账户已从本地助记词派生并加密保存');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '账户派生失败'); }
    finally { mnemonic = '';privateKey = '';setBusy(false); }
  }

  function removeWallet() {
    if (!vault || !selected || sensitive || !window.confirm(`删除 ${selected.name}？请先确认已有离线备份。`)) return;
    const next = { ...vault, wallets: vault.wallets.filter(wallet => wallet.id !== selected.id) };
    try { commitVault(next);setSelectedId(next.wallets[0]?.id ?? null);setNotice('钱包密文已从本机保险库删除'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败'); }
  }

  async function importVaultFile(file?: File) {
    if (!file || sensitive) return;
    if (vault?.wallets.length && !window.confirm('导入会替换当前浏览器中的本地保险库。请确认已先导出加密备份。')) return;
    setBusy(true);setError('');setNotice('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('保险库文件超过 5 MB');
      const imported = parseVault(await file.text());
      if (!imported) throw new Error('保险库文件为空');
      saveVault(imported);setVault(imported);setVaultKey(null);setSelectedId(imported.wallets[0]?.id ?? null);setNotice('加密保险库已导入，请输入原密码解锁');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保险库导入失败'); }
    finally { setBusy(false); }
  }

  async function copyAddress() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.address);setNotice('收款地址已复制'); }
    catch { setError('浏览器拒绝复制，请手动选择地址'); }
  }

  function addContact() {
    try {
      const entry = makeAddressBookEntry(contactLabelRef.current?.value ?? '', chain, contactAddressRef.current?.value ?? '');
      if (addressBook.some(item => item.chain === entry.chain && item.address === entry.address)) throw new Error('该联系人地址已存在');
      const next = [...addressBook, entry];saveAddressBook(next);setAddressBook(next);setNotice('联系人已保存在本机');
      if (contactLabelRef.current) contactLabelRef.current.value = '';
      if (contactAddressRef.current) contactAddressRef.current.value = '';
    } catch (cause) { setError(cause instanceof Error ? cause.message : '联系人保存失败'); }
  }

  function addToken() {
    if (!selected) return;
    try {
      const token = makeCustomToken(selected.id, selected.chain, tokenSymbolRef.current?.value ?? '', tokenAddressRef.current?.value ?? '', Number(tokenDecimalsRef.current?.value));
      if (tokens.some(item => item.walletId === token.walletId && item.address === token.address)) throw new Error('该 Token 已添加');
      const next = [...tokens, token];saveCustomTokens(next);setTokens(next);setNotice('自定义 Token 元数据已保存在本机');
      if (tokenSymbolRef.current) tokenSymbolRef.current.value = '';
      if (tokenAddressRef.current) tokenAddressRef.current.value = '';
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Token 保存失败'); }
  }

  if (!vault) return <section className="panel local-vault-gate"><LockKeyhole/><h3>创建本地钱包保险库</h3><p>保险库只保存 AES‑256‑GCM 密文。密码、私钥和助记词不会发送到 API、数据库或日志。</p><label>保险库密码<input ref={setupPasswordRef} type="password" minLength={12} autoComplete="new-password"/></label><label>再次输入<input ref={setupConfirmRef} type="password" minLength={12} autoComplete="new-password"/></label>{error && <div className="batch-error">{error}</div>}<button disabled={busy} onClick={() => void setupVault()}>{busy ? '正在加密…' : '创建本地保险库'}</button><label className="vault-file"><Upload size={15}/>恢复加密保险库<input type="file" accept="application/json,.json" onChange={event => void importVaultFile(event.target.files?.[0])}/></label></section>;

  if (!vaultKey) return <section className="panel local-vault-gate"><LockKeyhole/><h3>解锁本地钱包保险库</h3><p>{vault.wallets.length} 个钱包 · 密钥仅在当前标签页内存中可用 · 15 分钟无操作自动锁定</p><label>保险库密码<input ref={unlockPasswordRef} type="password" minLength={12} autoComplete="current-password" onKeyDown={event => { if (event.key === 'Enter') void unlock(); }}/></label>{error && <div className="batch-error">{error}</div>}{notice && <div className="provider-message">{notice}</div>}<button disabled={busy} onClick={() => void unlock()}>{busy ? '正在核验…' : '解锁'}</button><div className="vault-gate-actions"><button onClick={() => downloadEncryptedVault(vault)}><Download size={15}/>备份密文</button><label className="vault-file"><Upload size={15}/>导入密文<input type="file" accept="application/json,.json" onChange={event => void importVaultFile(event.target.files?.[0])}/></label></div></section>;

  const selectedTokens = tokens.filter(token => token.walletId === selected?.id);
  return <>
    <div className="local-vault-security"><ShieldCheck size={17}/>本地保险库已解锁 · AES‑256‑GCM + PBKDF2 600,000 · 自动锁定 · 明文密钥不持久化 · 上传 0</div>
    {error && <div className="batch-error">{error}</div>}{notice && <div className="provider-message">{notice}</div>}
    <div className="local-wallet-layout">
      <section className="panel local-wallet-list"><div className="panel-head"><h3>本地钱包</h3><span>{vault.wallets.length}</span></div>{vault.wallets.map(wallet => <button key={wallet.id} className={wallet.id === selected?.id ? 'active' : ''} disabled={sensitive} onClick={() => setSelectedId(wallet.id)}><span className={`provider-logo ${wallet.chain.toLowerCase()}`}>{wallet.chain.slice(0, 2)}</span><div><b>{wallet.name}</b><code>{wallet.address}</code><small>{wallet.origin} · {wallet.path}</small></div></button>)}{!vault.wallets.length && <div className="mini-empty"><WalletCards/><p>创建或导入第一个钱包</p></div>}</section>
      <section className="local-wallet-main">
        <section className="panel local-wallet-create"><div className="panel-head"><h3>创建 / 导入</h3><button onClick={lock}><LockKeyhole size={14}/>立即锁定</button></div><div className="wallet-mode-tabs">{(['create','mnemonic','private-key','keystore'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} disabled={busy || sensitive} onClick={() => setMode(value)}>{value === 'create' ? '创建新钱包' : value === 'mnemonic' ? '导入助记词' : value === 'private-key' ? '导入私钥' : '导入 Keystore'}</button>)}</div><div className="wallet-create-grid"><label>网络<select value={chain} disabled={busy || sensitive || mode === 'keystore'} onChange={event => setChain(event.target.value as BatchChain)}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select></label><label>钱包名称<input ref={nameRef} maxLength={128} placeholder="自动命名"/></label>{(mode === 'create' || mode === 'mnemonic') && <label>账户索引<input ref={indexRef} type="number" min="0" max="999" defaultValue="0"/></label>}</div>{mode === 'mnemonic' && <label>助记词<textarea ref={secretRef} rows={3} autoComplete="off" spellCheck={false}/></label>}{mode === 'private-key' && <label>私钥<textarea ref={secretRef} rows={3} autoComplete="off" spellCheck={false}/></label>}{mode === 'keystore' && <div className="wallet-create-grid"><label>Keystore JSON<input ref={keystoreRef} type="file" accept="application/json,.json"/></label><label>Keystore 密码<input ref={keystorePasswordRef} type="password" autoComplete="off"/></label></div>}<div className="notice"><ShieldCheck size={18}/>所有生成、派生、解密和加密均在浏览器本地完成；创建后请立即备份加密保险库。</div><button disabled={busy || sensitive} onClick={() => void addWallet()}><Plus size={15}/>{busy ? '本地处理中…' : mode === 'create' ? '创建并加密' : '导入并加密'}</button></section>
        {selected && <section className="panel local-wallet-detail"><div className="panel-head"><div><h3>{selected.name}</h3><code>{selected.chain} · {selected.path}</code></div><div className="detail-actions"><button onClick={() => void copyAddress()}><Copy size={14}/>复制地址</button><button disabled={!selected.hasMnemonic || busy || sensitive} onClick={() => void deriveNextAccount()}><KeyRound size={14}/>新账户</button><button className="danger" disabled={busy || sensitive} onClick={removeWallet}><Trash2 size={14}/>删除</button></div></div><div className="receive-card"><div>{qr ? <img src={qr} width="160" height="160" alt={`${selected.name} 收款二维码`}/> : <QrCode/>}</div><section><p className="eyebrow">RECEIVE</p><h3>收款地址</h3><code>{selected.address}</code><p className="wallet-signing-note">本地钱包可直接在隔离 Worker 内签署测试网交易；批量与主网执行仍使用独立门禁。</p><div className="detail-actions"><button onClick={() => navigate(`/batch-transfer?chain=${selected.chain}&from=${encodeURIComponent(selected.address)}`)}><Send size={14}/>创建批量任务</button><a href={explorerUrl(selected)} target="_blank" rel="noreferrer"><Eye size={14}/>查看余额、Token 与 NFT</a></div></section></div><LocalTransferPanel key={selected.id} wallet={selected} vaultKey={vaultKey} tokens={selectedTokens} disabled={busy || sensitive} onSensitiveStateChange={setSensitive}/><MigrationPanel wallet={selected} wallets={[selected]} batchSalt={vault.kdf.salt} batchRevision={vault.wallets.length} disabled={busy} allowMnemonic={selected.hasMnemonic} onSensitiveStateChange={setSensitive}/><div className="wallet-metadata-grid"><section><h3>自定义 Token</h3><div className="inline-fields"><input ref={tokenSymbolRef} placeholder="Symbol"/><input ref={tokenAddressRef} placeholder="合约 / Mint 地址"/><input ref={tokenDecimalsRef} type="number" min="0" max="30" defaultValue="18"/><button onClick={addToken}>添加</button></div>{selectedTokens.map(token => <div className="metadata-row" key={token.id}><b>{token.symbol}</b><code>{token.address}</code><span>{token.decimals}</span><button onClick={() => { const next = tokens.filter(item => item.id !== token.id);saveCustomTokens(next);setTokens(next); }}>删除</button></div>)}</section></div></section>}
      </section>
    </div>
    <section className="panel address-book"><div className="panel-head"><h3><BookUser size={16}/>地址簿</h3><span>仅公开地址 · 本机保存</span></div><div className="inline-fields"><input ref={contactLabelRef} placeholder="联系人名称"/><select value={chain} onChange={event => setChain(event.target.value as BatchChain)}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select><input ref={contactAddressRef} placeholder="公开地址"/><button onClick={addContact}>添加联系人</button></div>{addressBook.map(entry => <div className="metadata-row" key={entry.id}><b>{entry.label}</b><span>{entry.chain}</span><code>{entry.address}</code><button onClick={() => { const next = addressBook.filter(item => item.id !== entry.id);saveAddressBook(next);setAddressBook(next); }}>删除</button></div>)}</section>
    <div className="vault-footer-actions"><button onClick={() => downloadEncryptedVault(vault)}><Download size={15}/>导出加密保险库</button><label className="vault-file"><Upload size={15}/>导入加密保险库<input type="file" accept="application/json,.json" onChange={event => void importVaultFile(event.target.files?.[0])}/></label></div>
  </>;
}
