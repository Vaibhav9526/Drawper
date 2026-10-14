import logoUrl from '../../media/brand/logo.svg';

export function Logo({ size = 22 }: { size?: number }) {
  return <img src={logoUrl} width={size} height={size} alt="Drawper" style={{ borderRadius: size * 0.22, display: 'block' }} />;
}
