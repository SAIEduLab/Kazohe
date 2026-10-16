// The single registry of test-case IDs: group letter and number of cases.
// Adding or removing a case means changing the count here.
export const tcGroups = [
  ["M", 73],
  ["G", 19],
  ["S", 14],
  ["F", 30],
  ["T", 16],
  ["P", 28],
  ["B", 18],
  ["U", 18],
  ["E", 14],
];
export const tcIds = [
  ...tcGroups.flatMap(([group, count]) =>
    Array.from(
      { length: count },
      (_, i) => `TC-${group}${String(i + 1).padStart(2, "0")}`,
    ),
  ),
  ...["01", "02", "04", "05", "06", "07", "08"].map((n) => `TC-D${n}`),
];
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
        "TC-U13",
        "TC-U14",
      ].includes(id)
        ? [{ id, method: "visual" }]
        : []),
    ];
  if (/^TC-[MSFTP]/.test(id)) return [{ id, method: "unit" }];
  if (/^TC-G/.test(id)) return [{ id, method: "property" }];
  if (id === "TC-B15") return [{ id, method: "device" }];
  if (["TC-B16", "TC-B18"].includes(id)) return [{ id, method: "single-html" }];
  if (id === "TC-D08") return [{ id, method: "browser" }];
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
