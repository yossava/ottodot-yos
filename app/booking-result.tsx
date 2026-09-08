import type { BookingStatus, PaymentStatus } from "@prisma/client";

export type BookingView = { id: string; status: BookingStatus };
export type PaymentView = { status: PaymentStatus };

export function BookingResult({ booking, payment }: { booking: BookingView; payment: PaymentView | null }) {
  const needsRefund = payment?.status === "succeeded" && ["capacity_unavailable", "cancelled"].includes(booking.status);
  return (
    <section className="result" aria-label="Booking result" aria-live="polite">
      <h3>Booking status</h3>
      <dl>
        <div><dt>Payment</dt><dd>{payment?.status ?? "Not started"}</dd></div>
        <div><dt>Booking</dt><dd>{booking.status}</dd></div>
      </dl>
      {booking.status === "pending_payment" && <p>Your booking is pending. A seat is confirmed only after payment.</p>}
      {booking.status === "confirmed" && <p>Your seat is confirmed.</p>}
      {booking.status === "payment_failed" && <p>Payment failed. No seat was booked. Start a new booking to try again.</p>}
      {booking.status === "capacity_unavailable" && <p>The payment succeeded, but the class filled up before your seat could be confirmed.</p>}
      {booking.status === "cancelled" && <p>This booking was cancelled. Another confirmed booking may already exist for this student.</p>}
      {needsRefund && <>
        <p>No money was charged in this demo. In a live payment flow, the payment would be voided or refunded.</p>
        <div className="actions">
          <button disabled aria-describedby="deferred-actions">Refund payment</button>
          <button disabled aria-describedby="deferred-actions">Select another class</button>
        </div>
        <p id="deferred-actions" className="muted">Refunds and class transfers are not available in this demo.</p>
      </>}
      <p className="booking-id">Booking ID <code>{booking.id}</code></p>
    </section>
  );
}
