import { expect, test } from "@playwright/test";

test("successful payment confirms the booking and adds the student to the roster", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Student", { exact: true }).selectOption("student-finn");
  await page.getByRole("button", { name: "Book trial", exact: true }).click();
  const result = page.getByRole("region", { name: "Booking result" });
  const roster = page.getByRole("region", { name: "Class roster" });
  await expect(result).toContainText("pending_payment");
  await expect(result).toContainText("Not started");
  await expect(roster.getByRole("listitem")).toHaveText(["Alice"]);
  await page.getByRole("button", { name: "Simulate Successful Payment", exact: true }).click();
  await expect(result.getByRole("definition")).toHaveText(["succeeded", "confirmed"]);
  await expect(roster.getByRole("listitem")).toHaveText(["Alice", "Finn"]);
});

test("failed payment does not add the student to the roster", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Student", { exact: true }).selectOption("student-eve");
  const roster = page.getByRole("region", { name: "Class roster" });
  await expect(roster.getByRole("listitem").first()).toHaveText("Alice");
  const before = await roster.getByRole("listitem").allTextContents();
  await page.getByRole("button", { name: "Book trial", exact: true }).click();
  await page.getByRole("button", { name: "Simulate Failed Payment", exact: true }).click();
  await expect(page.getByRole("region", { name: "Booking result" }).getByRole("definition")).toHaveText(["failed", "payment_failed"]);
  await expect(roster.getByRole("listitem")).toHaveText(before);
});

test("a full class blocks payment after another student takes the last seat", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Student", { exact: true }).selectOption("student-eve");
  await page.getByLabel("Trial class", { exact: true }).selectOption("class-last-seat");
  await page.getByRole("button", { name: "Book trial", exact: true }).click();
  const result = page.getByRole("region", { name: "Booking result" });
  await expect(result).toContainText("pending_payment");
  const bookingId = await result.locator("code").innerText();
  const competing = await request.post("/api/bookings", { data: { studentId: "student-finn", trialClassId: "class-last-seat" } });
  expect(competing.status()).toBe(201);
  const paid = await request.post("/api/mock-payments", { data: { bookingId: (await competing.json()).id, outcome: "success" } });
  expect(paid.ok()).toBeTruthy();
  expect((await paid.json()).booking.status).toBe("confirmed");

  await page.getByRole("button", { name: "Simulate Successful Payment", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Payment was not started");
  await expect(result.getByRole("definition")).toHaveText(["Not started", "pending_payment"]);
  await expect(page.getByRole("region", { name: "Class roster" }).getByRole("listitem")).toHaveText(["Alice", "Ben", "Cara", "Finn"]);
  const booking = await request.get(`/api/bookings/${bookingId}`);
  expect(booking.ok()).toBeTruthy();
  expect((await booking.json()).paymentAttempts).toEqual([]);
});
