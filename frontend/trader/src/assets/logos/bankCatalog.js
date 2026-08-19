// Single source of truth for the trader panel's selectable bank / UPI provider
// catalog AND the name -> logo lookup that drives every BankBadge.
//
// Why a name-based layer at all: the API only accepts five canonical
// account_type values (gpay | phonepe | paytm | bharat_pe | airtel), and every
// plain bank is stored as `gpay`. So a *type*-keyed logo lookup (BANK_VISUALS
// in ui.jsx) can only ever show five icons — HDFC, SBI, ICICI et al. all collapse
// to the GPay logo. This catalog adds a *name*-keyed layer so each bank shows its
// own real logo, while the stored account_type (and therefore all matching /
// routing / settlement behaviour) is left completely untouched.
//
// Filenames are imported as Vite URL modules (same convention as the original
// three logos). The registry key is slugify(displayName) — computed here and in
// BankBadge from the same helper, so the picker list and the logo map can never
// drift apart.

// Wallets / UPI apps (type-keyed providers that also carry a real account_type).
import gpayLogo from './gpay-business-bank.svg';
import phonePeLogo from './phone-pe-mqr.svg';
import paytmLogo from './paytm.svg';
import bharatPeLogo from './bharatpe.svg';
import airtelLogo from './airtel.svg';
import mobikwikLogo from './mobikwik.svg';

// Banks — every one of these is stored as account_type `gpay` (the existing
// default for non-wallet banks); the logo below is display only.
import hdfcLogo from './hdfc-bank.svg';
import iciciLogo from './icici-bank.svg';
import axisLogo from './axis-bank.svg';
import sbiLogo from './sbi.svg';
import kotakLogo from './kotak.svg';
import pnbLogo from './pnb.svg';
import yesLogo from './yes.svg';
import indusindLogo from './indusind.svg';
import idfcLogo from './idfc-bank.svg';
import canaraLogo from './canara-bank.svg';
import bobLogo from './bank-of-baroda.svg';
import boiLogo from './bank-of-india.svg';
import bomLogo from './bank-of-maharashtra.svg';
import federalLogo from './federal-bank.svg';
import rblLogo from './rbl-bank.svg';
import bandhanLogo from './bandhan-bank.svg';
import karnatakaLogo from './karnataka-bank.svg';
import karurLogo from './karur-vysya-bank.svg';
import cityUnionLogo from './city-union-bank.svg';
import csbLogo from './csb-bank.svg';
import southIndianLogo from './south-indian-bank.svg';
import tmbLogo from './tmb-bank.svg';
import dhanlaxmiLogo from './dhanlaxmi-bank.svg';
import dbsLogo from './dbs-bank.svg';
import idbiLogo from './idbi-bank.svg';
import ucoLogo from './uco-bank.svg';
import centralLogo from './central-bank-of-india.svg';
import iobLogo from './indian-overseas-bank.svg';
import punjabSindLogo from './punjab-sind-bank.svg';
import jkLogo from './jk-bank.svg';
import unionLogo from './union-bank-of-india.svg';

// Small-finance / payments banks.
import indiaPostLogo from './india-post-payments-bank.svg';
import finoLogo from './fino-payments-bank.svg';
import nsdlLogo from './nsdl-payments-bank.svg';
import janaLogo from './jana-small-finance-bank.svg';
import esafLogo from './esaf-small-finance-bank.svg';
import fincareLogo from './fincare-small-finance-bank.svg';
import ujjivanLogo from './ujjivan-small-finance-bank.svg';
import keralaLogo from './kerala-bank.svg';

// Normalises a display name to a stable lookup key. MUST stay identical to the
// slugify used by BankBadge in ui.jsx. '&' and every run of non-alphanumerics
// collapse to a single '-', e.g. 'Punjab & Sind Bank' -> 'punjab-sind-bank',
// 'J&K Bank' -> 'j-k-bank'.
export const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Each entry: { name, type, color, logo }.
//   name  — the display label shown in the picker and the logo lookup key source
//   type  — the canonical account_type actually stored (unchanged routing enum)
//   color — tint for the initials fallback (only ever visible if a logo is
//           missing; harmless otherwise)
//   logo  — imported SVG URL
//
// Order: wallets/UPI apps first, then banks alphabetical — cosmetic only, the
// picker is searchable.
export const BANK_CATALOG = [
  // Wallets / UPI apps
  { name: 'GPay Business', type: 'gpay', color: 'sky', logo: gpayLogo },
  { name: 'PhonePe Business', type: 'phonepe', color: 'violet', logo: phonePeLogo },
  { name: 'Paytm Business', type: 'paytm', color: 'sky', logo: paytmLogo },
  { name: 'BharatPe Business', type: 'bharat_pe', color: 'amber', logo: bharatPeLogo },
  { name: 'Airtel Payments Bank', type: 'airtel', color: 'red', logo: airtelLogo },
  { name: 'MobiKwik', type: 'gpay', color: 'red', logo: mobikwikLogo },

  // AU Bank stays selectable but has no logo asset in this set -> initials only.
  { name: 'AU Bank', type: 'gpay', color: 'amber' },

  // Banks
  { name: 'Axis Bank', type: 'gpay', color: 'red', logo: axisLogo },
  { name: 'Bandhan Bank', type: 'gpay', color: 'red', logo: bandhanLogo },
  { name: 'Bank of Baroda', type: 'gpay', color: 'amber', logo: bobLogo },
  { name: 'Bank of India', type: 'gpay', color: 'sky', logo: boiLogo },
  { name: 'Bank of Maharashtra', type: 'gpay', color: 'amber', logo: bomLogo },
  { name: 'Canara Bank', type: 'gpay', color: 'amber', logo: canaraLogo },
  { name: 'Central Bank of India', type: 'gpay', color: 'sky', logo: centralLogo },
  { name: 'City Union Bank', type: 'gpay', color: 'red', logo: cityUnionLogo },
  { name: 'CSB Bank', type: 'gpay', color: 'sky', logo: csbLogo },
  { name: 'DBS Bank', type: 'gpay', color: 'red', logo: dbsLogo },
  { name: 'Dhanlaxmi Bank', type: 'gpay', color: 'violet', logo: dhanlaxmiLogo },
  { name: 'ESAF Small Finance Bank', type: 'gpay', color: 'sky', logo: esafLogo },
  { name: 'Federal Bank', type: 'gpay', color: 'amber', logo: federalLogo },
  { name: 'Fincare Small Finance Bank', type: 'gpay', color: 'violet', logo: fincareLogo },
  { name: 'Fino Payments Bank', type: 'gpay', color: 'sky', logo: finoLogo },
  { name: 'HDFC Bank', type: 'gpay', color: 'sky', logo: hdfcLogo },
  { name: 'ICICI Bank', type: 'gpay', color: 'amber', logo: iciciLogo },
  { name: 'IDBI Bank', type: 'gpay', color: 'violet', logo: idbiLogo },
  { name: 'IDFC FIRST Bank', type: 'gpay', color: 'violet', logo: idfcLogo },
  { name: 'India Post Payments Bank', type: 'gpay', color: 'red', logo: indiaPostLogo },
  { name: 'Indian Overseas Bank', type: 'gpay', color: 'sky', logo: iobLogo },
  { name: 'IndusInd Bank', type: 'gpay', color: 'red', logo: indusindLogo },
  { name: 'Jana Small Finance Bank', type: 'gpay', color: 'amber', logo: janaLogo },
  { name: 'J&K Bank', type: 'gpay', color: 'sky', logo: jkLogo },
  { name: 'Karnataka Bank', type: 'gpay', color: 'red', logo: karnatakaLogo },
  { name: 'Karur Vysya Bank', type: 'gpay', color: 'amber', logo: karurLogo },
  { name: 'Kerala Gramin Bank', type: 'gpay', color: 'sky', logo: keralaLogo },
  { name: 'Kotak Mahindra Bank', type: 'gpay', color: 'red', logo: kotakLogo },
  { name: 'NSDL Payments Bank', type: 'gpay', color: 'violet', logo: nsdlLogo },
  { name: 'PNB', type: 'gpay', color: 'violet', logo: pnbLogo },
  { name: 'Punjab & Sind Bank', type: 'gpay', color: 'amber', logo: punjabSindLogo },
  { name: 'RBL Bank', type: 'gpay', color: 'red', logo: rblLogo },
  { name: 'SBI', type: 'gpay', color: 'sky', logo: sbiLogo },
  { name: 'South Indian Bank', type: 'gpay', color: 'amber', logo: southIndianLogo },
  { name: 'Tamilnad Mercantile Bank', type: 'gpay', color: 'sky', logo: tmbLogo },
  { name: 'UCO Bank', type: 'gpay', color: 'violet', logo: ucoLogo },
  { name: 'Ujjivan Small Finance Bank', type: 'gpay', color: 'red', logo: ujjivanLogo },
  { name: 'Union Bank of India', type: 'gpay', color: 'red', logo: unionLogo },
  { name: 'YES Bank', type: 'gpay', color: 'sky', logo: yesLogo },
];

// slug(displayName) -> logo URL, for BankBadge's name-based resolution. Built
// from the same catalog so it always matches the selectable options exactly.
export const BANK_LOGOS = BANK_CATALOG.reduce((acc, b) => {
  if (b.logo) acc[slugify(b.name)] = b.logo;
  return acc;
}, {});

// Extra name aliases so a logo also resolves when the SAME bank is named the
// way the SMS bank-identification system labels it (BUG-58 display), which uses
// full official names where the picker uses an abbreviation or a merchant-app
// label. Without these, e.g. an SBI credit SMS (labelled "State Bank of India")
// would fall back to initials even though the SBI logo exists.
const LOGO_ALIASES = {
  'state bank of india': 'SBI',
  'punjab national bank': 'PNB',
  'google pay business': 'GPay Business',
  'paytm payments bank': 'Paytm Business',
  phonepe: 'PhonePe Business',
  bharatpe: 'BharatPe Business',
};
for (const [aliasName, canonicalName] of Object.entries(LOGO_ALIASES)) {
  const logo = BANK_LOGOS[slugify(canonicalName)];
  if (logo) BANK_LOGOS[slugify(aliasName)] = logo;
}
