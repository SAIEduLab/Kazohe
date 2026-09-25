import { readFileSync } from "node:fs";
export const tcIds = JSON.parse(
  readFileSync("tests/fixtures/tc-ids.json", "utf8"),
);
export const manifest = tcIds.flatMap((id) => {
  if (/^TC-E/.test(id)) return [{ id, method: "pedagogy" }];
  if (/^TC-U/.test(id))
    return [
      { id, method: "browser" },
      ...([
        "TC-U01",
        "TC-U03",
        "TC-U04",
        "TC-U05",
        "TC-U06",
        "TC-U07",
        "TC-U08",
        "TC-U11",
      ].includes(id)
        ? [{ id, method: "visual" }]
        : []),
    ];
  if (/^TC-[MSFTP]/.test(id)) return [{ id, method: "unit" }];
  if (/^TC-G/.test(id)) return [{ id, method: "property" }];
  if (id === "TC-B15") return [{ id, method: "device" }];
  if (["TC-B16", "TC-B18"].includes(id)) return [{ id, method: "single-html" }];
  if (/^TC-B/.test(id))
    return [
      { id, method: "browser" },
      ...(["TC-B04", "TC-B05", "TC-B06", "TC-B07", "TC-B12", "TC-B14"].includes(
        id,
      )
        ? [{ id, method: "visual" }]
        : []),
    ];
  return [
    { id, method: "lint" },
    ...(id === "TC-D05" ? [{ id, method: "visual" }] : []),
  ];
});
