import QRCode from 'qrcode';

export async function createMfaQrCode(otpauthUri: string): Promise<string> {
  if (!otpauthUri.startsWith('otpauth://totp/')) throw new Error('Invalid Authenticator enrollment URI');
  const dataUrl = await QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 220,
    color: { dark: '#07151dff', light: '#ffffffff' },
  });
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('Authenticator QR generation failed');
  return dataUrl;
}
