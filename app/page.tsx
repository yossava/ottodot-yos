"use client";

import { useEffect, useRef, useState } from "react";
import { BookingResult, type BookingView, type PaymentView } from "./booking-result";

type Student = { id: string; name: string };
type TrialClass = { id: string; title: string; startsAt: string; capacity: number; confirmedCount: number; seatsRemaining: number };
type Roster = TrialClass & { students: Student[] };
type BookingDetail = BookingView & { paymentAttempts: PaymentView[] };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    cache: "no-store",
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed. Please try again.");
  return result;
}

const dateLabel = (date: string) => new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
}).format(new Date(date));

export default function Home() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [studentId, setStudentId] = useState("");
  const [classId, setClassId] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterError, setRosterError] = useState("");
  const [rosterRevision, setRosterRevision] = useState(0);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [paymentUncertain, setPaymentUncertain] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const selectedClass = classes.find((c) => c.id === classId);

  useEffect(() => {
    let active = true;
    Promise.all([request<Student[]>("students"), request<TrialClass[]>("trial-classes")])
      .then(([students, classes]) => {
        if (!active) return;
        setStudents(students); setClasses(classes); setClassId(classes[0]?.id ?? "");
      }).catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!classId) return;
    let active = true;
    setRoster(null); setRosterError("");
    request<Roster>(`trial-classes/${classId}/roster`)
      .then((roster) => { if (active) setRoster(roster); })
      .catch((error: Error) => { if (active) setRosterError(error.message); });
    return () => { active = false; };
  }, [classId, rosterRevision]);

  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to connect. Please try again."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  async function refresh() {
    setClasses(await request<TrialClass[]>("trial-classes"));
    setRosterRevision((revision) => revision + 1);
  }

  async function readBooking() {
    if (!booking) return;
    const latest = await request<BookingDetail>(`bookings/${booking.id}`);
    setBooking(latest); setPayment(latest.paymentAttempts.at(-1) ?? null);
    setPaymentUncertain(false);
  }

  async function pay(outcome: "success" | "failure") {
    if (!booking) return;
    const latest = await request<TrialClass[]>("trial-classes");
    setClasses(latest);
    if (!latest.some((c) => c.id === classId && c.seatsRemaining > 0)) {
      setRosterRevision((revision) => revision + 1);
      throw new Error("This class is now full. Payment was not started. Availability does not reserve a seat.");
    }
    try {
      const result = await request<{ booking: BookingView; payment: PaymentView }>("mock-payments", { bookingId: booking.id, outcome });
      setBooking(result.booking); setPayment(result.payment);
    } catch (error) {
      // A lost response may follow a committed payment. Read its state before allowing a retry.
      try { await readBooking(); } catch {
        setPaymentUncertain(true);
        throw new Error("Payment result could not be checked. Refresh booking status before trying again.");
      }
      throw error;
    }
    await refresh();
  }

  return (
    <>
      <header><a href="/" className="brand">ottodot<span> / trial classes</span></a><span className="badge">Demo · no real charges</span></header>
      <main id="main">
        <div className="page-heading"><h1>Trial booking</h1><a href="#roster">View class roster ↓</a></div>
        {error && <p role="alert" className="error">{error}</p>}
        {!students ? <p role="status">{error ? <button onClick={() => location.reload()}>Retry loading</button> : "Loading classes…"}</p> :
          <div className="columns">
            <section className="panel" aria-labelledby="booking-heading">
              <p className="eyebrow">For parents</p><h2 id="booking-heading">Book a trial</h2>
              <form onSubmit={(event) => {
                event.preventDefault();
                void run("Creating booking…", async () => {
                  const booking = await request<BookingView>("bookings", { studentId, trialClassId: classId });
                  setBooking(booking); setPayment(null);
                });
              }}>
                <fieldset disabled={Boolean(busy || booking)}>
                  <label htmlFor="student">Student</label>
                  <select id="student" required value={studentId} onChange={(event) => { setStudentId(event.target.value); setError(""); }}>
                    <option value="">Choose a student</option>
                    {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <label htmlFor="trial-class">Trial class</label>
                  <select id="trial-class" required value={classId} onChange={(event) => { setClassId(event.target.value); setError(""); }}>
                    {!classes.length && <option value="">No classes available</option>}
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.confirmedCount}/{c.capacity} confirmed{c.seatsRemaining === 0 ? " · Full" : c.seatsRemaining === 1 ? " · Last seat" : ""}</option>)}
                  </select>
                </fieldset>
                {selectedClass && <div className="class-summary">
                  <strong>{selectedClass.title}</strong><p>{dateLabel(selectedClass.startsAt)} WIB</p>
                  <p>{selectedClass.confirmedCount}/{selectedClass.capacity} confirmed · {selectedClass.seatsRemaining} {selectedClass.seatsRemaining === 1 ? "seat" : "seats"} remaining</p>
                  <p className="muted">Availability is advisory. Pending bookings do not reserve seats.</p>
                  {selectedClass.seatsRemaining === 0 && !booking && <p className="full">This class is full. Choose another class.</p>}
                </div>}
                {!booking && <button className="primary" disabled={Boolean(busy) || !studentId || !selectedClass || selectedClass.seatsRemaining === 0}>Book trial</button>}
              </form>
              {booking && <>
                <BookingResult booking={booking} payment={payment} />
                {booking.status === "pending_payment" && <div className="actions">
                  <button className="primary" disabled={Boolean(busy) || paymentUncertain} onClick={() => void run("Processing payment…", () => pay("success"))}>Simulate Successful Payment</button>
                  <button disabled={Boolean(busy) || paymentUncertain} onClick={() => void run("Processing payment…", () => pay("failure"))}>Simulate Failed Payment</button>
                </div>}
                <div className="actions secondary-actions">
                  <button disabled={Boolean(busy)} onClick={() => void run("Refreshing status…", async () => { await readBooking(); await refresh(); })}>Refresh booking status</button>
                  <button disabled={Boolean(busy) || paymentUncertain} onClick={() => { setBooking(null); setPayment(null); setError(""); }}>Start a new booking</button>
                </div>
              </>}
              <p className="muted" role="status">{busy || "Payments are simulated. No money is charged."}</p>
            </section>
            <section id="roster" className="panel roster" aria-labelledby="roster-heading">
              <div className="section-heading"><div><p className="eyebrow">For teachers</p><h2 id="roster-heading">Class roster</h2></div>
                <button disabled={Boolean(busy) || !classId} onClick={() => void run("Refreshing class…", refresh)}>Refresh</button>
              </div>
              <p className="muted">Confirmed students in the selected class.</p>
              <div aria-live="polite">
                {rosterError ? <p role="alert" className="error">{rosterError}</p> : roster ? <>
                  <h3>{roster.title}</h3><p className="muted">{dateLabel(roster.startsAt)} WIB</p>
                  <p className="occupancy"><strong>{roster.confirmedCount}</strong> / {roster.capacity} confirmed</p>
                  {roster.students.length ? <ol>{roster.students.map((s) => <li key={s.id}>{s.name}</li>)}</ol> : <p>No confirmed students yet.</p>}
                </> : <p>{classId ? "Loading roster…" : "Choose a class to see its roster."}</p>}
              </div>
            </section>
          </div>}
      </main>
    </>
  );
}
