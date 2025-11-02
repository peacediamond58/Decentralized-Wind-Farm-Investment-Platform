// OracleFeed.test.ts

import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_KWH = 101;
const ERR_INVALID_PRICE = 102;
const ERR_YIELD_DISTRIBUTOR_NOT_SET = 105;

interface ProductionData {
  kwhProduced: bigint;
  pricePerKwh: bigint;
  timestamp: bigint;
}

class OracleFeedMock {
  state: {
    owner: string;
    yieldDistributor: string;
    authorizedOracles: Set<string>;
    farmProduction: Map<string, ProductionData>;
    lastUpdate: bigint;
    calls: Array<{ method: string; args: any[] }>;
  };
  caller: string;
  contract: string;
  blockHeight: bigint;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      owner: "ST1OWNER",
      yieldDistributor: "ST2DISTRIBUTOR",
      authorizedOracles: new Set(),
      farmProduction: new Map(),
      lastUpdate: 0n,
      calls: [],
    };
    this.caller = "ST1OWNER";
    this.contract = "ST3ORACLE";
    this.blockHeight = 100n;
  }

  key(farmId: bigint, height: bigint): string {
    return `${farmId}-${height}`;
  }

  isOracleAuthorized(oracle: string): boolean {
    return this.state.authorizedOracles.has(oracle);
  }

  getLastProduction(farmId: bigint): ProductionData | undefined {
    return this.state.farmProduction.get(
      this.key(farmId, this.state.lastUpdate)
    );
  }

  setYieldDistributor(distributor: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.yieldDistributor = distributor;
    return { ok: true, value: true };
  }

  addOracle(oracle: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.authorizedOracles.add(oracle);
    return { ok: true, value: true };
  }

  removeOracle(oracle: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.authorizedOracles.delete(oracle);
    return { ok: true, value: true };
  }

  submitProductionData(
    farmId: bigint,
    kwh: bigint,
    price: bigint
  ): { ok: boolean; value: boolean | number } {
    if (!this.state.authorizedOracles.has(this.caller))
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (kwh <= 0n) return { ok: false, value: ERR_INVALID_KWH };
    if (price <= 0n) return { ok: false, value: ERR_INVALID_PRICE };
    if (this.state.yieldDistributor === this.contract)
      return { ok: false, value: ERR_YIELD_DISTRIBUTOR_NOT_SET };

    const key = this.key(farmId, this.blockHeight);
    this.state.farmProduction.set(key, {
      kwhProduced: kwh,
      pricePerKwh: price,
      timestamp: this.blockHeight,
    });
    this.state.lastUpdate = this.blockHeight;

    this.state.calls.push({
      method: "submit-revenue",
      args: [farmId, kwh, price],
    });

    this.blockHeight += 1n;
    return { ok: true, value: true };
  }

  emergencyWithdraw(): void {
    if (this.caller !== this.state.owner) throw new Error("Unauthorized");
  }
}

describe("OracleFeed", () => {
  let mock: OracleFeedMock;

  beforeEach(() => {
    mock = new OracleFeedMock();
    mock.reset();
  });

  it("authorizes oracle and submits data", () => {
    mock.addOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.setYieldDistributor("ST2DISTRIBUTOR");

    const result = mock.submitProductionData(1n, 1500n, 2500n);
    expect(result.ok).toBe(true);
    const data = mock.getLastProduction(1n);
    expect(data?.kwhProduced).toBe(1500n);
    expect(data?.pricePerKwh).toBe(2500n);
    expect(mock.state.calls[0].method).toBe("submit-revenue");
  });

  it("blocks unauthorized oracle", () => {
    mock.caller = "ST1HACKER";
    const result = mock.submitProductionData(1n, 100n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects zero kWh", () => {
    mock.addOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.setYieldDistributor("ST2DISTRIBUTOR");
    const result = mock.submitProductionData(1n, 0n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_KWH);
  });

  it("rejects zero price", () => {
    mock.addOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.setYieldDistributor("ST2DISTRIBUTOR");
    const result = mock.submitProductionData(1n, 100n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PRICE);
  });

  it("tracks multiple updates with correct block height", () => {
    mock.addOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.setYieldDistributor("ST2DISTRIBUTOR");

    mock.submitProductionData(1n, 1000n, 2000n);
    mock.submitProductionData(1n, 1200n, 2200n);

    expect(mock.state.lastUpdate).toBe(101n);
    expect(mock.state.calls.length).toBe(2);
  });

  it("owner can add and remove oracles", () => {
    mock.addOracle("ST1ORACLE");
    expect(mock.isOracleAuthorized("ST1ORACLE")).toBe(true);
    mock.removeOracle("ST1ORACLE");
    expect(mock.isOracleAuthorized("ST1ORACLE")).toBe(false);
  });

  it("only owner can set distributor", () => {
    mock.caller = "ST1HACKER";
    const result = mock.setYieldDistributor("ST2DISTRIBUTOR");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });
});
