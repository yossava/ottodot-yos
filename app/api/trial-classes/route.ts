import { apiResponse } from "../../../lib/api";
import { listTrialClasses } from "../../../lib/bookings";

export async function GET() {
  return apiResponse(listTrialClasses);
}
