import { BookingError } from "./bookings";

export async function apiResponse(action: () => Promise<unknown>, status = 200) {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await action(), { status, headers });
  } catch (error) {
    if (error instanceof BookingError) {
      const status = error.code === "INVALID_INPUT" ? 400 : error.code === "NOT_FOUND" ? 404 : error.code === "DATABASE_BUSY" ? 503 : 409;
      return Response.json({ error: { code: error.code, message: error.message } }, { status, headers });
    }
    console.error(error);
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unable to complete the request." } }, { status: 500, headers });
  }
}
