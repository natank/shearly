import { describe, expect, it } from 'vitest';
import { templates } from './templates.js';

describe('templates', () => {
  it('renders the correct subject and text for a registered event/locale pair', () => {
    const summary = {
      slotStart: new Date('2026-01-15T10:00:00Z'),
      priceMinor: 20000,
      currency: 'ILS',
      serviceName: 'Haircut',
    };
    const enEmail = templates.confirmedCustomer('en', summary);
    expect(enEmail.subject).toBe('Your booking is confirmed');
    expect(enEmail.text).toContain('Haircut');

    const heEmail = templates.confirmedCustomer('he', summary);
    expect(heEmail.subject).toBe('ההזמנה שלך אושרה');
    expect(heEmail.text).toContain('Haircut');
  });

  it('RTL renders correctly in the Hebrew template: the html document carries dir="rtl", the English one dir="ltr" (structural, not just script detection)', () => {
    const summary = {
      slotStart: new Date('2026-01-15T10:00:00Z'),
      priceMinor: 20000,
      currency: 'ILS',
      serviceName: 'Haircut',
    };
    const he = templates.confirmedCustomer('he', summary);
    expect(he.html).toMatch(/<html[^>]*\bdir="rtl"/);
    expect(he.html).toMatch(/<html[^>]*\blang="he"/);

    const en = templates.confirmedCustomer('en', summary);
    expect(en.html).toMatch(/<html[^>]*\bdir="ltr"/);
    expect(en.html).toMatch(/<html[^>]*\blang="en"/);
  });

  it('escapes HTML-significant characters in the service name', () => {
    const summary = {
      slotStart: new Date('2026-01-15T10:00:00Z'),
      priceMinor: 20000,
      currency: 'ILS',
      serviceName: '<script>alert(1)</script>',
    };
    const rendered = templates.confirmedCustomer('en', summary);
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });
});
