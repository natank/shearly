export type Locale = 'en' | 'he';

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

const DIR: Record<Locale, 'ltr' | 'rtl'> = { en: 'ltr', he: 'rtl' };

/**
 * Wraps every template's body in a minimal HTML document with the correct
 * `dir` attribute for the locale (NFR-I18N-006) — the one structural RTL
 * property an email client actually honors, as opposed to CSS logical
 * properties which most clients strip.
 */
function wrap(locale: Locale, bodyHtml: string): string {
  return `<!doctype html><html lang="${locale}" dir="${DIR[locale]}"><body>${bodyHtml}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type BookingSummary = {
  slotStart: Date;
  priceMinor: number;
  currency: string;
  serviceName: string;
};

function formatSlot(locale: Locale, slotStart: Date): string {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(slotStart);
}

function formatMoney(locale: Locale, amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100);
}

type Copy = { subject: string; lines: string[] };

const en = {
  bookingCreatedCustomer: (b: BookingSummary): Copy => ({
    subject: 'Your booking request was sent',
    lines: [
      `We sent your request for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      `The provider has a limited time to respond — we'll let you know as soon as they do.`,
    ],
  }),
  bookingCreatedProvider: (b: BookingSummary, deadline: Date): Copy => ({
    subject: 'New booking request',
    lines: [
      `You have a new request for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      `Please respond by ${formatSlot('en', deadline)}, or the request will expire automatically.`,
    ],
  }),
  confirmedCustomer: (b: BookingSummary): Copy => ({
    subject: 'Your booking is confirmed',
    lines: [
      `Your booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} is confirmed.`,
    ],
  }),
  confirmedProvider: (b: BookingSummary): Copy => ({
    subject: 'Booking confirmed',
    lines: [
      `You confirmed the booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
    ],
  }),
  declinedCustomer: (b: BookingSummary): Copy => ({
    subject: 'Your booking request was declined',
    lines: [
      `Your request for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} was declined.`,
      `Any authorization on your card has been released. Browse other providers to find another time.`,
    ],
  }),
  expiredCustomer: (b: BookingSummary): Copy => ({
    subject: 'Your booking request expired',
    lines: [
      `Your request for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} expired without a response.`,
      `Any authorization on your card has been released. Browse other providers to find another time.`,
    ],
  }),
  expiredProvider: (b: BookingSummary): Copy => ({
    subject: 'A booking request expired',
    lines: [
      `A request for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} expired before you responded.`,
    ],
  }),
  cancelledByCustomerForCustomer: (b: BookingSummary, refundMinor: number): Copy => ({
    subject: 'Your cancellation is confirmed',
    lines: [
      `You cancelled your booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      refundMinor > 0
        ? `A refund of ${formatMoney('en', refundMinor, b.currency)} is on its way to your card.`
        : `No refund applies under the cancellation window for this booking.`,
    ],
  }),
  cancelledByCustomerForProvider: (b: BookingSummary): Copy => ({
    subject: 'A booking was cancelled',
    lines: [
      `The customer cancelled the booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
    ],
  }),
  cancelledByProviderForCustomer: (b: BookingSummary): Copy => ({
    subject: 'Your booking was cancelled by the provider',
    lines: [
      `The provider cancelled your booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      `Any authorization on your card has been released. Browse other providers to find another time.`,
    ],
  }),
  cancelledByProviderForProvider: (b: BookingSummary): Copy => ({
    subject: 'Cancellation recorded',
    lines: [
      `You cancelled the booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      `This cancellation counts toward your standing record.`,
    ],
  }),
  completedCustomer: (b: BookingSummary): Copy => ({
    subject: 'Your booking is complete — leave a review',
    lines: [
      `Your booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} is complete. Total charged: ${formatMoney('en', b.priceMinor, b.currency)}.`,
      `Let others know how it went — leave a review.`,
    ],
  }),
  completedProvider: (b: BookingSummary, netMinor: number): Copy => ({
    subject: 'Booking completed — earnings recorded',
    lines: [
      `The booking for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} is complete. Net earnings: ${formatMoney('en', netMinor, b.currency)}.`,
    ],
  }),
  // NOT-001's matrix: the customer column always gets "outcome + dispute
  // path," the provider column always gets a plain outcome notice —
  // regardless of which party was the one marked absent.
  noShowCustomerReportedForCustomer: (b: BookingSummary): Copy => ({
    subject: 'No-show recorded on your booking',
    lines: [
      `You were marked as a no-show for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      `If you believe this is wrong, contact support to dispute it.`,
    ],
  }),
  noShowCustomerReportedForProvider: (b: BookingSummary): Copy => ({
    subject: 'No-show recorded',
    lines: [
      `The customer was marked as a no-show for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
    ],
  }),
  noShowProviderReportedForCustomer: (b: BookingSummary): Copy => ({
    subject: 'No-show recorded on your booking',
    lines: [
      `The provider was marked as a no-show for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
      `If you believe this is wrong, contact support to dispute it.`,
    ],
  }),
  noShowProviderReportedForProvider: (b: BookingSummary): Copy => ({
    subject: 'No-show recorded',
    lines: [
      `You were marked as a no-show for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
    ],
  }),
  refundIssued: (b: BookingSummary, amountMinor: number): Copy => ({
    subject: 'Your refund is on its way',
    lines: [
      `A refund of ${formatMoney('en', amountMinor, b.currency)} for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)} has been issued.`,
      `It typically arrives within 5-10 business days, depending on your bank.`,
    ],
  }),
  // NOT-002: both parties are reminded ahead of a CONFIRMED booking.
  reminderCustomer: (b: BookingSummary): Copy => ({
    subject: 'Reminder: your upcoming booking',
    lines: [
      `This is a reminder for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
    ],
  }),
  reminderProvider: (b: BookingSummary): Copy => ({
    subject: 'Reminder: upcoming booking',
    lines: [
      `This is a reminder for ${escapeHtml(b.serviceName)} on ${formatSlot('en', b.slotStart)}.`,
    ],
  }),
};

const he = {
  bookingCreatedCustomer: (b: BookingSummary): Copy => ({
    subject: 'בקשת ההזמנה שלך נשלחה',
    lines: [
      `שלחנו את בקשתך עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      `לנותן השירות יש זמן מוגבל להגיב — נעדכן אותך ברגע שהוא יגיב.`,
    ],
  }),
  bookingCreatedProvider: (b: BookingSummary, deadline: Date): Copy => ({
    subject: 'בקשת הזמנה חדשה',
    lines: [
      `יש לך בקשה חדשה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      `אנא הגב עד ${formatSlot('he', deadline)}, אחרת הבקשה תפוג באופן אוטומטי.`,
    ],
  }),
  confirmedCustomer: (b: BookingSummary): Copy => ({
    subject: 'ההזמנה שלך אושרה',
    lines: [
      `ההזמנה שלך עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} אושרה.`,
    ],
  }),
  confirmedProvider: (b: BookingSummary): Copy => ({
    subject: 'ההזמנה אושרה',
    lines: [
      `אישרת את ההזמנה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
    ],
  }),
  declinedCustomer: (b: BookingSummary): Copy => ({
    subject: 'בקשת ההזמנה שלך נדחתה',
    lines: [
      `בקשתך עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} נדחתה.`,
      `כל חיוב שהוחזק בכרטיס שלך שוחרר. חפש נותני שירות אחרים למועד חדש.`,
    ],
  }),
  expiredCustomer: (b: BookingSummary): Copy => ({
    subject: 'בקשת ההזמנה שלך פגה',
    lines: [
      `בקשתך עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} פגה ללא מענה.`,
      `כל חיוב שהוחזק בכרטיס שלך שוחרר. חפש נותני שירות אחרים למועד חדש.`,
    ],
  }),
  expiredProvider: (b: BookingSummary): Copy => ({
    subject: 'בקשת הזמנה פגה',
    lines: [
      `בקשה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} פגה לפני שהגבת.`,
    ],
  }),
  cancelledByCustomerForCustomer: (b: BookingSummary, refundMinor: number): Copy => ({
    subject: 'הביטול שלך אושר',
    lines: [
      `ביטלת את ההזמנה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      refundMinor > 0
        ? `החזר כספי בסך ${formatMoney('he', refundMinor, b.currency)} בדרך לכרטיס שלך.`
        : `לא חל החזר כספי במסגרת חלון הביטול של הזמנה זו.`,
    ],
  }),
  cancelledByCustomerForProvider: (b: BookingSummary): Copy => ({
    subject: 'הזמנה בוטלה',
    lines: [
      `הלקוח ביטל את ההזמנה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
    ],
  }),
  cancelledByProviderForCustomer: (b: BookingSummary): Copy => ({
    subject: 'ההזמנה שלך בוטלה על ידי נותן השירות',
    lines: [
      `נותן השירות ביטל את ההזמנה שלך עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      `כל חיוב שהוחזק בכרטיס שלך שוחרר. חפש נותני שירות אחרים למועד חדש.`,
    ],
  }),
  cancelledByProviderForProvider: (b: BookingSummary): Copy => ({
    subject: 'הביטול נרשם',
    lines: [
      `ביטלת את ההזמנה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      `ביטול זה נספר במעמד שלך.`,
    ],
  }),
  completedCustomer: (b: BookingSummary): Copy => ({
    subject: 'ההזמנה שלך הושלמה — השאר ביקורת',
    lines: [
      `ההזמנה שלך עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} הושלמה. סכום שחויב: ${formatMoney('he', b.priceMinor, b.currency)}.`,
      `ספר לאחרים איך היה — השאר ביקורת.`,
    ],
  }),
  completedProvider: (b: BookingSummary, netMinor: number): Copy => ({
    subject: 'ההזמנה הושלמה — הרווח נרשם',
    lines: [
      `ההזמנה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} הושלמה. רווח נטו: ${formatMoney('he', netMinor, b.currency)}.`,
    ],
  }),
  noShowCustomerReportedForCustomer: (b: BookingSummary): Copy => ({
    subject: 'אי-הגעה נרשמה בהזמנה שלך',
    lines: [
      `סומנת כמי שלא הגיע/ה עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      `אם אתה חושב שזו טעות, פנה לתמיכה כדי לערער.`,
    ],
  }),
  noShowCustomerReportedForProvider: (b: BookingSummary): Copy => ({
    subject: 'אי-הגעה נרשמה',
    lines: [
      `הלקוח סומן כמי שלא הגיע עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
    ],
  }),
  noShowProviderReportedForCustomer: (b: BookingSummary): Copy => ({
    subject: 'אי-הגעה נרשמה בהזמנה שלך',
    lines: [
      `נותן השירות סומן כמי שלא הגיע עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
      `אם אתה חושב שזו טעות, פנה לתמיכה כדי לערער.`,
    ],
  }),
  noShowProviderReportedForProvider: (b: BookingSummary): Copy => ({
    subject: 'אי-הגעה נרשמה',
    lines: [
      `סומנת כמי שלא הגיע עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
    ],
  }),
  refundIssued: (b: BookingSummary, amountMinor: number): Copy => ({
    subject: 'ההחזר הכספי שלך בדרך',
    lines: [
      `החזר כספי בסך ${formatMoney('he', amountMinor, b.currency)} עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)} הונפק.`,
      `בדרך כלל הוא מגיע תוך 5-10 ימי עסקים, בהתאם לבנק שלך.`,
    ],
  }),
  reminderCustomer: (b: BookingSummary): Copy => ({
    subject: 'תזכורת: ההזמנה הקרובה שלך',
    lines: [
      `זוהי תזכורת עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
    ],
  }),
  reminderProvider: (b: BookingSummary): Copy => ({
    subject: 'תזכורת: הזמנה קרובה',
    lines: [
      `זוהי תזכורת עבור ${escapeHtml(b.serviceName)} בתאריך ${formatSlot('he', b.slotStart)}.`,
    ],
  }),
};

const copyByLocale: Record<Locale, typeof en> = { en, he };

function render(locale: Locale, copy: Copy): RenderedEmail {
  const html = wrap(locale, copy.lines.map((line) => `<p>${line}</p>`).join(''));
  const text = copy.lines.join('\n\n');
  return { subject: copy.subject, text, html };
}

export const templates = {
  bookingCreatedCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].bookingCreatedCustomer(b)),
  bookingCreatedProvider: (locale: Locale, b: BookingSummary, deadline: Date) =>
    render(locale, copyByLocale[locale].bookingCreatedProvider(b, deadline)),
  confirmedCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].confirmedCustomer(b)),
  confirmedProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].confirmedProvider(b)),
  declinedCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].declinedCustomer(b)),
  expiredCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].expiredCustomer(b)),
  expiredProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].expiredProvider(b)),
  cancelledByCustomerForCustomer: (locale: Locale, b: BookingSummary, refundMinor: number) =>
    render(locale, copyByLocale[locale].cancelledByCustomerForCustomer(b, refundMinor)),
  cancelledByCustomerForProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].cancelledByCustomerForProvider(b)),
  cancelledByProviderForCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].cancelledByProviderForCustomer(b)),
  cancelledByProviderForProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].cancelledByProviderForProvider(b)),
  completedCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].completedCustomer(b)),
  completedProvider: (locale: Locale, b: BookingSummary, netMinor: number) =>
    render(locale, copyByLocale[locale].completedProvider(b, netMinor)),
  noShowCustomerReportedForCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].noShowCustomerReportedForCustomer(b)),
  noShowCustomerReportedForProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].noShowCustomerReportedForProvider(b)),
  noShowProviderReportedForCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].noShowProviderReportedForCustomer(b)),
  noShowProviderReportedForProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].noShowProviderReportedForProvider(b)),
  refundIssued: (locale: Locale, b: BookingSummary, amountMinor: number) =>
    render(locale, copyByLocale[locale].refundIssued(b, amountMinor)),
  reminderCustomer: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].reminderCustomer(b)),
  reminderProvider: (locale: Locale, b: BookingSummary) =>
    render(locale, copyByLocale[locale].reminderProvider(b)),
};
