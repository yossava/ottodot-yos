import { apiResponse } from "../../../../lib/api";
import { getBooking } from "../../../../lib/bookings";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => getBooking((await params).id));
}
