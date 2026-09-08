import { apiResponse } from "../../../lib/api";
import { listStudents } from "../../../lib/bookings";

export async function GET() {
  return apiResponse(listStudents);
}
