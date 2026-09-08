import { apiResponse } from "../../../../../lib/api";
import { getTrialClassRoster } from "../../../../../lib/bookings";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => getTrialClassRoster((await params).id));
}
