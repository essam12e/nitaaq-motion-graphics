/**
 * Licence gate for sounds that enter the shared library (pure).
 *
 * A sound is used AUTOMATICALLY only when its licence clearly allows the use:
 *   cleared  CC0, Public Domain Mark: any use, no attribution;
 *            CC BY: commercial use allowed, the attribution goes into the project's credits.
 *   review   CC BY-SA (share-alike on an ad's soundtrack is unclear), the retired Sampling+:
 *            kept in the library, never picked by itself; a person decides.
 *   blocked  NonCommercial licences in a commercial project, NoDerivatives (syncing, trimming
 *            and mixing to picture is an adaptation), and anything without a clear licence.
 */
export type LicenseStatus = 'cleared' | 'review' | 'blocked';

export interface LicenseInfo {
  /** Short code as the source gives it: cc0, pdm, by, by-sa, by-nc, … */
  code: string;
  version?: string;
  url?: string;
  author?: string;
  authorUrl?: string;
  title?: string;
  /** The page the sound came from. */
  landing?: string;
  /** The file's own URL. */
  fileUrl?: string;
  provider?: string;
  /** Ready-made attribution line (CC BY). */
  attribution?: string;
}

export function normaliseLicense(code: string | undefined): string {
  const l = (code ?? '').trim().toLowerCase().replace(/^cc[-_ ]?/, '').replace(/[ _]+/g, '-').replace(/-\d(\.\d)?$/, '');
  if (!l) return '';
  if (l === '0' || l === 'zero' || l === 'cc0' || l === 'public-domain-dedication') return 'cc0';
  if (l === 'pdm' || l === 'public-domain' || l === 'publicdomain') return 'pdm';
  return l;
}

export function licenseStatus(info: Pick<LicenseInfo, 'code'> | undefined, commercial = true): { status: LicenseStatus; why: string; attribution: boolean } {
  const c = normaliseLicense(info?.code);
  if (!c) return { status: 'blocked', why: 'no clear licence', attribution: false };
  if (c === 'cc0' || c === 'pdm') return { status: 'cleared', why: `${c.toUpperCase()}: any use`, attribution: false };
  if (c === 'by') return { status: 'cleared', why: 'CC BY: commercial use allowed with attribution', attribution: true };
  if (c.includes('nd')) return { status: 'blocked', why: `CC ${c.toUpperCase()}: no derivatives (syncing and mixing to picture adapts the sound)`, attribution: true };
  if (c.includes('nc')) return commercial ? { status: 'blocked', why: `CC ${c.toUpperCase()}: non-commercial only, this is a commercial project`, attribution: true } : { status: c.includes('sa') ? 'review' : 'cleared', why: `CC ${c.toUpperCase()}: non-commercial project`, attribution: true };
  if (c === 'by-sa') return { status: 'review', why: 'CC BY-SA: share-alike on a film soundtrack needs a person to decide', attribution: true };
  if (c.includes('sampling')) return { status: 'review', why: `${c}: a retired licence, decide by hand`, attribution: true };
  return { status: 'blocked', why: `unknown licence "${info?.code}"`, attribution: false };
}

/** One credits line (CC BY and friends). */
export function creditLine(i: LicenseInfo): string {
  if (i.attribution) return i.attribution;
  const lic = normaliseLicense(i.code);
  const name = lic === 'cc0' ? 'CC0 1.0' : lic === 'pdm' ? 'Public Domain Mark' : `CC ${lic.toUpperCase()}${i.version ? ` ${i.version}` : ''}`;
  return `"${i.title ?? 'untitled'}" by ${i.author ?? 'unknown'}${i.provider ? ` (${i.provider})` : ''}, ${name}${i.url ? ` (${i.url})` : ''}${i.landing ? ` — ${i.landing}` : ''}`;
}
