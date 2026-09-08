import { apiResponse } from "../../../lib/api";
import { BookingError, createTrialBooking } from "../../../lib/bookings";

export async function POST(request: Request) {
  return apiResponse(async () => {
    const body: unknown = await request.json().catch(() => {
      throw new BookingError("INVALID_INPUT", "Request body must be valid JSON.");
    });
    return createTrialBooking(body);
  }, 201);
}
