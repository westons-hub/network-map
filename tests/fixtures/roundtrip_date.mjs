// Helper for workbook.test.mjs: round-trips dates under whatever TZ it's run with.
import { makePerson } from "../../site/js/core/people.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../../site/js/core/workbook.js";

const m = { ...emptyModel("X"), people: [makePerson({ name: "A", connectedOn: "2026-03-12" })],
            pool: [{ firstName: "B", lastName: "", url: "", email: "", company: "", position: "", connectedOn: "02 Jan 2025" }] };
m.pool[0].connectedOn = "2025-01-02";
const back = readWorkbook(writeWorkbook(m));
console.log(`${back.people[0].connectedOn}|${back.pool[0].connectedOn}`);
