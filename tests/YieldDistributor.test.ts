import { describe, it, expect, beforeEach } from "vitest";

interface Farm {
  totalSupply: bigint;
  totalRevenue: bigint;
  lastDistributed: bigint;
  accumulatedYieldPerShare: bigint;
}

interface InvestorYield {
  claimedYieldPerShare: bigint;
  pendingYield: bigint;
}

interface RevenueUpdate {
  kwhProduced: bigint;
  pricePerKwh: bigint;
  revenue: bigint;
  blockHeight: bigint;
}

const ERR_NOT_AUTHORIZED = 100;
const ERR_FARM_NOT_FOUND = 101;
const ERR_INVALID_REVENUE = 102;
const ERR_INVALID_TOTAL_SUPPLY = 103;
const ERR_NO_PENDING_YIELD = 104;
const ERR_ORACLE_NOT_AUTHORIZED = 105;
const ERR_ZERO_SHARES = 108;

class YieldDistributorMock {
  state: {
    oracle: string;
    nonce: bigint;
    farms: Map<bigint, Farm>;
    investorYields: Map<string, InvestorYield>;
    revenueUpdates: Map<bigint, RevenueUpdate>;
    stxTransfers: Array<{ amount: bigint; to: string }>;
  };
  caller: string;
  contract: string;
  blockHeight: bigint;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      oracle: "ST1ORACLE",
      nonce: 0n,
      farms: new Map(),
      investorYields: new Map(),
      revenueUpdates: new Map(),
      stxTransfers: [],
    };
    this.caller = "ST1ORACLE";
    this.contract = "ST2CONTRACT";
    this.blockHeight = 100n;
  }

  key(farmId: bigint, investor: string): string {
    return `${farmId.toString()}-${investor}`;
  }

  getFarm(farmId: bigint): Farm | undefined {
    return this.state.farms.get(farmId);
  }

  getPendingYield(farmId: bigint, investor: string): InvestorYield {
    return (
      this.state.investorYields.get(this.key(farmId, investor)) ?? {
        claimedYieldPerShare: 0n,
        pendingYield: 0n,
      }
    );
  }

  registerFarm(
    farmId: bigint,
    initialSupply: bigint
  ): { ok: boolean; value: boolean | number } {
    if (initialSupply <= 0n)
      return { ok: false, value: ERR_INVALID_TOTAL_SUPPLY };
    if (this.state.farms.has(farmId))
      return { ok: false, value: ERR_FARM_NOT_FOUND };
    this.state.farms.set(farmId, {
      totalSupply: initialSupply,
      totalRevenue: 0n,
      lastDistributed: 0n,
      accumulatedYieldPerShare: 0n,
    });
    return { ok: true, value: true };
  }

  updateShares(
    farmId: bigint,
    investor: string,
    newShares: bigint
  ): { ok: boolean; value: boolean | number } {
    const farm = this.state.farms.get(farmId);
    if (!farm) return { ok: false, value: ERR_FARM_NOT_FOUND };
    this.updateInvestorYield(farmId, investor, farm.totalSupply);
    this.state.farms.set(farmId, { ...farm, totalSupply: newShares });
    return { ok: true, value: true };
  }

  submitRevenue(
    farmId: bigint,
    kwh: bigint,
    price: bigint
  ): { ok: boolean; value: bigint | number } {
    if (this.caller !== this.state.oracle)
      return { ok: false, value: ERR_ORACLE_NOT_AUTHORIZED };
    const revenue = kwh * price;
    if (revenue <= 0n) return { ok: false, value: ERR_INVALID_REVENUE };
    const farm = this.state.farms.get(farmId);
    if (!farm) return { ok: false, value: ERR_FARM_NOT_FOUND };
    if (farm.totalSupply <= 0n) return { ok: false, value: ERR_ZERO_SHARES };

    const additional = (revenue * 1000000n) / farm.totalSupply;
    const newAyps = farm.accumulatedYieldPerShare + additional;

    this.state.farms.set(farmId, {
      ...farm,
      totalRevenue: farm.totalRevenue + revenue,
      accumulatedYieldPerShare: newAyps,
    });

    this.state.revenueUpdates.set(this.state.nonce, {
      kwhProduced: kwh,
      pricePerKwh: price,
      revenue,
      blockHeight: this.blockHeight,
    });
    this.state.nonce += 1n;
    return { ok: true, value: revenue };
  }

  claimYield(
    farmId: bigint,
    investor: string
  ): { ok: boolean; value: bigint | number } {
    const key = this.key(farmId, investor);
    const data = this.state.investorYields.get(key) ?? {
      claimedYieldPerShare: 0n,
      pendingYield: 0n,
    };
    if (data.pendingYield <= 0n)
      return { ok: false, value: ERR_NO_PENDING_YIELD };

    const farm = this.state.farms.get(farmId)!;
    this.state.investorYields.set(key, {
      claimedYieldPerShare: farm.accumulatedYieldPerShare,
      pendingYield: 0n,
    });
    this.state.stxTransfers.push({ amount: data.pendingYield, to: investor });
    return { ok: true, value: data.pendingYield };
  }

  updateInvestorYield(
    farmId: bigint,
    investor: string,
    totalSupply: bigint
  ): void {
    const farm = this.state.farms.get(farmId)!;
    const data = this.getPendingYield(farmId, investor);
    const owed =
      farm.accumulatedYieldPerShare > data.claimedYieldPerShare
        ? farm.accumulatedYieldPerShare - data.claimedYieldPerShare
        : 0n;
    const pending = totalSupply > 0n ? (owed * totalSupply) / 1000000n : 0n;
    const newData: InvestorYield = {
      claimedYieldPerShare: farm.accumulatedYieldPerShare,
      pendingYield: data.pendingYield + pending,
    };
    this.state.investorYields.set(this.key(farmId, investor), newData);
  }

  setOracle(newOracle: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.oracle) return { ok: false, value: false };
    this.state.oracle = newOracle;
    return { ok: true, value: true };
  }
}

describe("YieldDistributor", () => {
  let mock: YieldDistributorMock;

  beforeEach(() => {
    mock = new YieldDistributorMock();
    mock.reset();
  });

  it("registers and reads farm correctly", () => {
    const result = mock.registerFarm(1n, 1000n);
    expect(result.ok).toBe(true);
    const farm = mock.getFarm(1n);
    expect(farm?.totalSupply).toBe(1000n);
    expect(farm?.accumulatedYieldPerShare).toBe(0n);
  });

  it("rejects zero initial supply", () => {
    const result = mock.registerFarm(1n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TOTAL_SUPPLY);
  });

  it("rejects claim with no pending yield", () => {
    mock.registerFarm(1n, 1000n);
    const result = mock.claimYield(1n, "ST1INVESTOR");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NO_PENDING_YIELD);
  });

  it("only oracle can submit revenue", () => {
    mock.registerFarm(1n, 1000n);
    mock.caller = "ST1HACKER";
    const result = mock.submitRevenue(1n, 100n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_AUTHORIZED);
  });

  it("oracle can be changed by current oracle", () => {
    const result = mock.setOracle("ST2NEWORACLE");
    expect(result.ok).toBe(true);
    expect(mock.state.oracle).toBe("ST2NEWORACLE");
  });
});
