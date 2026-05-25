const fs = require("fs");
const path = require("path");
const pool = require("../db");

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations(
      filename TEXT PRIMARY KEY,
      run_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const migrationDir = path.join(__dirname, "../migrations");

  const files = fs
    .readdirSync(migrationDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  const ran = await pool.query(
    `SELECT filename FROM schema_migrations`
  );

  const completed = new Set(
    ran.rows.map(r => r.filename)
  );

  for (const file of files) {

    if (completed.has(file)) {
      console.log("skip:", file);
      continue;
    }

    console.log("running:", file);

    const sql =
      fs.readFileSync(
        path.join(migrationDir,file),
        "utf8"
      );

    await pool.query("BEGIN");

    try {

      await pool.query(sql);

      await pool.query(
        `
        INSERT INTO schema_migrations(filename)
        VALUES($1)
        `,
        [file]
      );

      await pool.query("COMMIT");

      console.log("done:", file);

    } catch(err){

      await pool.query("ROLLBACK");

      throw err;
    }
  }

  process.exit();
}

migrate();