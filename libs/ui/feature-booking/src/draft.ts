export type BookingDraft = {
  providerId: string;
  serviceId: string;
  slotStart: string;
  addressLine: string;
  accessNotes?: string;
  lat: number;
  lng: number;
};

export type BookingSelection = Omit<BookingDraft, 'addressLine' | 'accessNotes' | 'lat' | 'lng'> & {
  addressLine?: string;
  accessNotes?: string;
  lat?: number;
  lng?: number;
};

/**
 * CUS-001: a guest's slot + address selection must survive the detour
 * through sign-in/register. `isComplete` decides whether the confirm screen
 * has everything it needs to call POST /bookings, or must still ask for the
 * address — pure so both the confirm screen and its tests share one truth.
 */
export function isCompleteDraft(draft: Partial<BookingDraft>): draft is BookingDraft {
  return Boolean(
    draft.providerId &&
    draft.serviceId &&
    draft.slotStart &&
    draft.addressLine &&
    typeof draft.lat === 'number' &&
    typeof draft.lng === 'number',
  );
}
