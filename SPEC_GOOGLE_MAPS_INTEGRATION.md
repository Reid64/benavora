# SPEC_GOOGLE_MAPS_INTEGRATION.md
## AFS — Google Maps Integration
**Phase 4**

---

## 1. USE CASES

**Address Autocomplete (Checkout):**
Google Places API on delivery address field.
Prevents typos. Auto-fills city, state, ZIP.
Restricted: US addresses only, address types only.

**Contact Page Map (BLOCKED #5):**
Static map embed showing AFS facility.
BLOCKED: AFS address not yet received.
Placeholder: address text only until map enabled.

**Delivery Route Display (future):**
When carrier integration complete: estimated route on order tracking.
GPS fleet tracking if AFS uses own trucks (pending checklist #80).

---

## 2. ADDRESS AUTOCOMPLETE SETUP

```typescript
// components/checkout/AddressAutocomplete.tsx
// Uses @googlemaps/js-api-loader
// On selection: auto-populates street, city, state, ZIP fields
// API key restrictions: Authorized domains + Places API + Maps JavaScript API only

// NEXT_PUBLIC_GOOGLE_MAPS_KEY — client-side key (restrict to authorized domains)
```

---

*SPEC_GOOGLE_MAPS_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
