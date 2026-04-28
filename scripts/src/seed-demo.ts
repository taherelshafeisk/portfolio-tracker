/**
 * Seed a realistic demo portfolio for DEMO_USER_ID.
 * Idempotent: deletes all existing demo data before re-seeding.
 *
 * Run: pnpm seed:demo  (from repo root)
 */
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000999";

const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Wipe existing demo data (order matters — FK dependencies) ──────────
    const tables = [
      "order_suggestions",
      "alerts",
      "position_flags",
      "price_alerts",
      "portfolio_snapshots",
      "activities",
      "positions",
      "accounts",
      "portfolio_policy",
      "macro_posture",
      "convictions",
      "conversations",
      "policy_proposals",
      "ips_builder_sessions",
    ];
    for (const t of tables) {
      await client.query(`DELETE FROM ${t} WHERE user_id = $1`, [DEMO_USER_ID]);
    }
    console.log("Cleared existing demo data.");

    // ── Accounts (two sleeves) ─────────────────────────────────────────────
    const { rows: accountRows } = await client.query<{ id: number }>(
      `INSERT INTO accounts
         (name, broker, account_type, current_balance, sleeve_key,
          concentration_limit, leverage_ceiling, user_id, created_at, updated_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8, NOW(), NOW()),
         ($9,$10,$11,$12,$13,$14,$15,$16, NOW(), NOW())
       RETURNING id`,
      [
        // Growth sleeve
        "Growth Portfolio", "Interactive Brokers", "individual", "24500.00",
        "growth", "0.20", "1.50", DEMO_USER_ID,
        // Crypto sleeve
        "Crypto Sleeve", "Coinbase", "individual", "3200.00",
        "crypto", "0.30", "1.00", DEMO_USER_ID,
      ],
    );

    const growthAccId = accountRows[0]!.id;
    const cryptoAccId = accountRows[1]!.id;
    console.log(`Accounts: growth=${growthAccId}, crypto=${cryptoAccId}`);

    // ── Positions ─────────────────────────────────────────────────────────
    type Pos = {
      accountId: number;
      symbol: string;
      name: string;
      qty: string;
      avgCost: string;
      currentPrice: string;
      bucket: string;
      action: string;
    };

    const positions: Pos[] = [
      // Growth sleeve — equity core
      { accountId: growthAccId, symbol: "AAPL", name: "Apple Inc.",          qty: "15",   avgCost: "158.40", currentPrice: "189.30", bucket: "core",        action: "hold"    },
      { accountId: growthAccId, symbol: "MSFT", name: "Microsoft Corp.",      qty: "8",    avgCost: "312.00", currentPrice: "415.60", bucket: "core",        action: "hold"    },
      { accountId: growthAccId, symbol: "NVDA", name: "NVIDIA Corp.",         qty: "10",   avgCost: "480.00", currentPrice: "875.40", bucket: "core",        action: "hold"    },
      { accountId: growthAccId, symbol: "AMZN", name: "Amazon.com Inc.",      qty: "12",   avgCost: "145.00", currentPrice: "182.50", bucket: "core",        action: "hold"    },
      { accountId: growthAccId, symbol: "JPM",  name: "JPMorgan Chase",       qty: "20",   avgCost: "165.00", currentPrice: "196.80", bucket: "anchor",      action: "hold"    },
      { accountId: growthAccId, symbol: "GLD",  name: "SPDR Gold Shares ETF", qty: "18",   avgCost: "178.00", currentPrice: "214.90", bucket: "def",         action: "hold"    },
      { accountId: growthAccId, symbol: "VOO",  name: "Vanguard S&P 500 ETF", qty: "25",   avgCost: "390.00", currentPrice: "476.20", bucket: "anchor",      action: "hold"    },
      // Growth sleeve — speculative / swing
      { accountId: growthAccId, symbol: "PLTR", name: "Palantir Technologies", qty: "80",  avgCost: "18.50",  currentPrice: "22.10",  bucket: "speculative", action: "watch"   },
      { accountId: growthAccId, symbol: "RKLB", name: "Rocket Lab USA",        qty: "200", avgCost: "5.80",   currentPrice: "7.40",   bucket: "speculative", action: "hold"    },
      { accountId: growthAccId, symbol: "IONQ", name: "IonQ Inc.",             qty: "150", avgCost: "8.20",   currentPrice: "11.60",  bucket: "speculative", action: "watch"   },
      // Crypto sleeve
      { accountId: cryptoAccId, symbol: "BTC",  name: "Bitcoin",              qty: "0.08", avgCost: "42000",  currentPrice: "67500",  bucket: "crypto",      action: "hold"    },
      { accountId: cryptoAccId, symbol: "ETH",  name: "Ethereum",             qty: "1.20", avgCost: "2400",   currentPrice: "3520",   bucket: "crypto",      action: "hold"    },
    ];

    for (const p of positions) {
      await client.query(
        `INSERT INTO positions
           (account_id, symbol, name, quantity, avg_cost, current_price,
            position_bucket, ips_action, user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW())`,
        [p.accountId, p.symbol, p.name, p.qty, p.avgCost, p.currentPrice,
         p.bucket, p.action, DEMO_USER_ID],
      );
    }
    console.log(`Inserted ${positions.length} positions.`);

    // ── Sample activities ─────────────────────────────────────────────────
    type Act = {
      accountId: number;
      symbol: string | null;
      activityType: string;
      qty: string | null;
      price: string | null;
      total: string | null;
      notes: string;
      date: string;
    };

    const activities: Act[] = [
      // Initial deposits
      { accountId: growthAccId, symbol: null, activityType: "deposit",    qty: null,   price: null,     total: "50000.00", notes: "Initial funding",          date: "2023-01-05" },
      { accountId: cryptoAccId, symbol: null, activityType: "deposit",    qty: null,   price: null,     total: "10000.00", notes: "Crypto allocation",        date: "2023-01-05" },
      // Buys
      { accountId: growthAccId, symbol: "AAPL", activityType: "buy",      qty: "15",   price: "158.40", total: null,       notes: "Core position initiation", date: "2023-02-10" },
      { accountId: growthAccId, symbol: "MSFT", activityType: "buy",      qty: "8",    price: "312.00", total: null,       notes: "Core position initiation", date: "2023-02-10" },
      { accountId: growthAccId, symbol: "NVDA", activityType: "buy",      qty: "10",   price: "480.00", total: null,       notes: "AI theme entry",           date: "2023-03-15" },
      { accountId: growthAccId, symbol: "AMZN", activityType: "buy",      qty: "12",   price: "145.00", total: null,       notes: "Cloud/retail core",        date: "2023-03-15" },
      { accountId: growthAccId, symbol: "VOO",  activityType: "buy",      qty: "25",   price: "390.00", total: null,       notes: "Index anchor",             date: "2023-04-01" },
      { accountId: growthAccId, symbol: "JPM",  activityType: "buy",      qty: "20",   price: "165.00", total: null,       notes: "Financials anchor",        date: "2023-04-01" },
      { accountId: growthAccId, symbol: "GLD",  activityType: "buy",      qty: "18",   price: "178.00", total: null,       notes: "Gold hedge",               date: "2023-05-10" },
      { accountId: growthAccId, symbol: "PLTR", activityType: "buy",      qty: "80",   price: "18.50",  total: null,       notes: "AI data play",             date: "2023-06-20" },
      { accountId: growthAccId, symbol: "RKLB", activityType: "buy",      qty: "200",  price: "5.80",   total: null,       notes: "Space speculation",        date: "2023-07-14" },
      { accountId: growthAccId, symbol: "IONQ", activityType: "buy",      qty: "150",  price: "8.20",   total: null,       notes: "Quantum computing bet",    date: "2023-09-01" },
      { accountId: cryptoAccId, symbol: "BTC",  activityType: "buy",      qty: "0.08", price: "42000",  total: null,       notes: "BTC core position",        date: "2023-01-20" },
      { accountId: cryptoAccId, symbol: "ETH",  activityType: "buy",      qty: "1.20", price: "2400",   total: null,       notes: "ETH position",             date: "2023-01-20" },
      // Dividend
      { accountId: growthAccId, symbol: "JPM",  activityType: "dividend", qty: null,   price: null,     total: "48.00",    notes: "Q2 dividend",              date: "2023-07-03" },
    ];

    for (const a of activities) {
      await client.query(
        `INSERT INTO activities
           (account_id, symbol, activity_type, quantity, price, total_amount, notes, trade_date, user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())`,
        [a.accountId, a.symbol, a.activityType, a.qty, a.price, a.total, a.notes, a.date, DEMO_USER_ID],
      );
    }
    console.log(`Inserted ${activities.length} activities.`);

    // ── Portfolio policy ───────────────────────────────────────────────────
    await client.query(
      `INSERT INTO portfolio_policy
         (gold_floor_pct, gold_target_pct, monthly_contribution, user_id, updated_at)
       VALUES ($1,$2,$3,$4, NOW())`,
      ["0.05", "0.08", "2000.00", DEMO_USER_ID],
    );
    console.log("Inserted portfolio policy.");

    // ── Macro posture ──────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO macro_posture
         (label, notes, crypto_view, is_active, user_id, created_at)
       VALUES ($1,$2,$3,$4,$5, NOW())`,
      [
        "Risk-On / Cautious",
        "Fed pivot expected H2 2025; staying long equities with gold hedge. Watching credit spreads.",
        "Accumulate on dips, no leverage",
        true,
        DEMO_USER_ID,
      ],
    );
    console.log("Inserted macro posture.");

    await client.query("COMMIT");
    console.log(`\nDemo seed complete for user ${DEMO_USER_ID}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
