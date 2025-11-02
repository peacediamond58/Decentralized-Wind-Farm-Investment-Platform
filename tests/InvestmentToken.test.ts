// InvestmentToken.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_FARM_NOT_REGISTERED = 101;
const ERR_INSUFFICIENT_BALANCE = 102;
const ERR_ZERO_AMOUNT = 103;

interface FarmToken {
  totalSupply: bigint;
  farmName: string;
  capacityMw: bigint;
}

class InvestmentTokenMock {
  state: {
    owner: string;
    yieldDistributor: string;
    balances: Map<string, bigint>;
    farmTokens: Map<bigint, FarmToken>;
    stxTransfers: Array<{ amount: bigint; from: string; to: string }>;
    calls: Array<{ method: string; args: any[] }>;
  };
  caller: string;
  contract: string;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      owner: "ST1OWNER",
      yieldDistributor: "ST2DISTRIBUTOR",
      balances: new Map(),
      farmTokens: new Map(),
      stxTransfers: [],
      calls: [],
    };
    this.caller = "ST1OWNER";
    this.contract = "ST3TOKEN";
  }

  getTokenBalance(owner: string): bigint {
    return this.state.balances.get(owner) ?? 0n;
  }

  getTotalSupply(): bigint {
    return Array.from(this.state.balances.values()).reduce((a, b) => a + b, 0n);
  }

  getFarmInfo(farmId: bigint): FarmToken | undefined {
    return this.state.farmTokens.get(farmId);
  }

  setYieldDistributor(distributor: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.yieldDistributor = distributor;
    return { ok: true, value: true };
  }

  registerFarm(
    farmId: bigint,
    name: string,
    capacityMw: bigint,
    initialSupply: bigint
  ): { ok: boolean; value: boolean | number } {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (initialSupply <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    if (this.state.farmTokens.has(farmId))
      return { ok: false, value: ERR_FARM_NOT_REGISTERED };

    this.state.balances.set(
      this.state.owner,
      (this.state.balances.get(this.state.owner) ?? 0n) + initialSupply
    );
    this.state.farmTokens.set(farmId, {
      totalSupply: initialSupply,
      farmName: name,
      capacityMw,
    });
    this.state.calls.push({
      method: "register-farm",
      args: [farmId, initialSupply],
    });
    return { ok: true, value: true };
  }

  buyShares(
    farmId: bigint,
    amount: bigint
  ): { ok: boolean; value: boolean | number } {
    if (amount <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    const farm = this.state.farmTokens.get(farmId);
    if (!farm) return { ok: false, value: ERR_FARM_NOT_REGISTERED };

    const cost = amount * 1000000n;
    this.state.stxTransfers.push({
      amount: cost,
      from: this.caller,
      to: this.contract,
    });

    const oldBalance = this.state.balances.get(this.caller) ?? 0n;
    this.state.balances.set(this.caller, oldBalance + amount);

    this.state.farmTokens.set(farmId, {
      ...farm,
      totalSupply: farm.totalSupply + amount,
    });

    this.state.calls.push({
      method: "update-shares",
      args: [farmId, this.caller, farm.totalSupply + amount],
    });

    return { ok: true, value: true };
  }

  sellShares(
    farmId: bigint,
    amount: bigint
  ): { ok: boolean; value: boolean | number } {
    if (amount <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    const balance = this.state.balances.get(this.caller) ?? 0n;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };

    const farm = this.state.farmTokens.get(farmId);
    if (!farm) return { ok: false, value: ERR_FARM_NOT_REGISTERED };

    this.state.balances.set(this.caller, balance - amount);
    const refund = amount * 1000000n;
    this.state.stxTransfers.push({
      amount: refund,
      from: this.contract,
      to: this.caller,
    });

    this.state.farmTokens.set(farmId, {
      ...farm,
      totalSupply: farm.totalSupply - amount,
    });

    this.state.calls.push({
      method: "update-shares",
      args: [farmId, this.caller, farm.totalSupply - amount],
    });

    return { ok: true, value: true };
  }

  transferShares(
    farmId: bigint,
    amount: bigint,
    recipient: string
  ): { ok: boolean; value: boolean | number } {
    if (amount <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    const balance = this.state.balances.get(this.caller) ?? 0n;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };

    this.state.balances.set(this.caller, balance - amount);
    this.state.balances.set(
      recipient,
      (this.state.balances.get(recipient) ?? 0n) + amount
    );

    this.state.calls.push(
      {
        method: "update-shares",
        args: [farmId, this.caller, balance - amount],
      },
      {
        method: "update-shares",
        args: [farmId, recipient, this.state.balances.get(recipient) ?? 0n],
      }
    );

    return { ok: true, value: true };
  }

  claimYield(farmId: bigint): { ok: boolean; value: any } {
    this.state.calls.push({ method: "claim-yield", args: [farmId] });
    return { ok: true, value: null };
  }
}

describe("InvestmentToken", () => {
  let mock: InvestmentTokenMock;

  beforeEach(() => {
    mock = new InvestmentTokenMock();
    mock.reset();
  });

  it("registers farm and mints initial shares", () => {
    const result = mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    expect(result.ok).toBe(true);
    expect(mock.getTokenBalance("ST1OWNER")).toBe(1000n);
    expect(mock.getFarmInfo(1n)?.farmName).toBe("NorthWind");
    expect(mock.state.calls[0].method).toBe("register-farm");
  });

  it("allows investor to buy shares", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1INVESTOR";
    const result = mock.buyShares(1n, 200n);
    expect(result.ok).toBe(true);
    expect(mock.getTokenBalance("ST1INVESTOR")).toBe(200n);
    expect(mock.state.farmTokens.get(1n)?.totalSupply).toBe(1200n);
    expect(mock.state.stxTransfers[0].amount).toBe(200000000n);
  });

  it("allows investor to sell shares", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1OWNER";
    mock.buyShares(1n, 300n);
    const result = mock.sellShares(1n, 100n);
    expect(result.ok).toBe(true);
    expect(mock.getTokenBalance("ST1OWNER")).toBe(1200n);
    expect(mock.state.farmTokens.get(1n)?.totalSupply).toBe(1200n);
    expect(
      mock.state.stxTransfers[mock.state.stxTransfers.length - 1].amount
    ).toBe(100000000n);
  });

  it("transfers shares between users", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1ALICE";
    mock.buyShares(1n, 500n);
    const result = mock.transferShares(1n, 200n, "ST1BOB");
    expect(result.ok).toBe(true);
    expect(mock.getTokenBalance("ST1ALICE")).toBe(300n);
    expect(mock.getTokenBalance("ST1BOB")).toBe(200n);
    expect(
      mock.state.calls.filter((c) => c.method === "update-shares").length
    ).toBe(3);
  });

  it("claims yield via distributor", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1INVESTOR";
    mock.buyShares(1n, 100n);
    const result = mock.claimYield(1n);
    expect(result.ok).toBe(true);
    expect(mock.state.calls[mock.state.calls.length - 1].method).toBe(
      "claim-yield"
    );
  });

  it("rejects buy with zero amount", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1INVESTOR";
    const result = mock.buyShares(1n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ZERO_AMOUNT);
  });

  it("rejects sell with insufficient balance", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1INVESTOR";
    const result = mock.sellShares(1n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("only owner can register farm", () => {
    mock.caller = "ST1HACKER";
    const result = mock.registerFarm(1n, "HackFarm", 10n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("updates total supply correctly on buy/sell", () => {
    mock.registerFarm(1n, "NorthWind", 50n, 1000n);
    mock.caller = "ST1INVESTOR";
    mock.buyShares(1n, 400n);
    mock.caller = "ST1TRADER";
    mock.buyShares(1n, 600n);
    expect(mock.state.farmTokens.get(1n)?.totalSupply).toBe(2000n);
    mock.caller = "ST1INVESTOR";
    mock.sellShares(1n, 200n);
    expect(mock.state.farmTokens.get(1n)?.totalSupply).toBe(1800n);
  });
});
