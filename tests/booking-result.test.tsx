import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BookingResult } from "../app/booking-result";

test("pending bookings show that payment has not started", () => {
  const html = renderToStaticMarkup(<BookingResult booking={{ id: "pending", status: "pending_payment" }} payment={null} />);
  expect(html).toContain("Not started");
  expect(html).toContain("pending_payment");
  expect(html).toContain('aria-live="polite"');
  expect(html).not.toContain("Refund payment");
});

test.each([
  ["confirmed", "succeeded", "Your seat is confirmed."],
  ["payment_failed", "failed", "Payment failed. No seat was booked."],
] as const)("renders %s separately from payment", (status, payment, message) => {
  const html = renderToStaticMarkup(<BookingResult booking={{ id: "booking", status }} payment={{ status: payment }} />);
  expect(html).toContain(`<dt>Payment</dt><dd>${payment}</dd>`);
  expect(html).toContain(`<dt>Booking</dt><dd>${status}</dd>`);
  expect(html).toContain(message);
  expect(html).not.toContain("Refund payment");
});

test.each(["capacity_unavailable", "cancelled"] as const)("paid %s shows disabled recovery actions without claiming a refund", (status) => {
  const html = renderToStaticMarkup(<BookingResult booking={{ id: "paid-no-seat", status }} payment={{ status: "succeeded" }} />);
  expect(html).toContain("succeeded");
  expect(html).toContain(status);
  expect(html).toContain("No money was charged in this demo.");
  expect(html).toContain("would be voided or refunded");
  expect(html).toContain('<button disabled="" aria-describedby="deferred-actions">Refund payment</button>');
  expect(html).toContain('<button disabled="" aria-describedby="deferred-actions">Select another class</button>');
});
