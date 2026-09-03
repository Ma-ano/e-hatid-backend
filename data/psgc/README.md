# Luzon PSGC snapshot

This directory contains E-Hatid's normalized geographic reference snapshot for Luzon.

## Source and freshness

- Authoritative publisher: Philippine Statistics Authority (PSA)
- Dataset: Philippine Standard Geographic Code (PSGC)
- Effective date: 30 June 2026 (Second Quarter 2026)
- Official publication page: <https://psa.gov.ph/classification/psgc>
- Official publication file: <https://psa.gov.ph/system/files/scd/PSGC-2Q-2026-Publication-Datafile.xlsx>

The PSA file endpoint required interactive Cloudflare verification during this implementation. The complete Q1 2026 identity and hierarchy data was normalized from `psgc==2026.4.13.0`, a community distribution that identifies PSA's Q1 2026 release as its source. The one Q2 2026 change affecting Luzon—`Parang Parang` in Orani, Bataan corrected to `Parang-Parang`—was then applied from PSA's official Q2 release notice. No coordinate, area, population, or postal-code enrichment from that package is imported.

Replace/verify the normalized snapshot against the official Q2 XLSX whenever direct access is available. Do not invent values to fill source gaps.

## Files

- `psgc-luzon-2026-06-30.csv`: complete imported Luzon hierarchy, including barangays.
- `psgc-luzon-inventory-2026-06-30.json`: complete region/province/city/municipality/submunicipality inventory, counts, checksums, and priority-area LGU lists.
- `psgc-nueva-ecija-2026-06-30.csv`: complete Nueva Ecija export, including all 849 barangays.
- `psgc-ncr-2026-06-30.csv`: complete NCR export, including all 1,715 barangays and Manila's 14 official submunicipalities.

## Rebuild and import

The snapshot builder takes the four normalized source JSON files (`regions.json`, `provinces.json`, `cities.json`, and `barangays.json`):

```powershell
node tools/build-luzon-snapshot.mjs <source-core-directory> data/psgc/psgc-luzon-2026-06-30.csv
```

Validate without database writes:

```powershell
npm run psgc:validate
```

Perform the idempotent bulk upsert and preserve existing recruitment content:

```powershell
npm run psgc:sync
```

The import lock expires after 30 minutes if a process terminates unexpectedly. Removed or superseded PSGC records are marked inactive; they are not deleted.
