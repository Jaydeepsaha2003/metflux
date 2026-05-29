// Selects the brand-specific siteData JSON at build time.
//
// Consumers import this module without an extension:
//   import siteData from "@/data/siteData";
//
// The active brand is decided by NEXT_PUBLIC_BRAND (see brand.config.ts).
// Both brand JSONs are bundled — bundle bloat is negligible (~14 KB each) and
// the trade-off buys a single switchable export with full type inference.
import { BRAND } from '@/brand/brand.config';
import metflux from './siteData.metflux.json';
import toroflux from './siteData.toroflux.json';

const siteData = BRAND === 'toroflux' ? toroflux : metflux;

export default siteData;
