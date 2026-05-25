const pool = require("../db");

async function generateEntityCode(prefix, table, column) {
  while (true) {
    const number = Math.floor(100000 + Math.random() * 900000);
    const code = `${prefix}-${number}`;

    const result = await pool.query(
      `SELECT id FROM ${table} WHERE ${column} = $1 LIMIT 1`,
      [code]
    );

    if (result.rows.length === 0) return code;
  }
}

module.exports = {
  generateKBT: () => generateEntityCode("KBT", "users", "contact_code"),
  generateKOI: () => generateEntityCode("KOI", "koibitos", "koibito_code"),

  generateDeviceId: (device_type = "pi") => {
    const prefix =
      device_type === "esp"
        ? "KSP"
        : "KOI";

    return generateEntityCode(
      prefix,
      "devices",
      "device_id"
    );
  },
};
