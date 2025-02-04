import assert from "assert";
import { Contract } from "starknet";
import { CreatePoolParams, Deployer, Pool, PragmaContracts, ProtocolContracts } from ".";

export class Protocol implements ProtocolContracts {
  constructor(
    public singleton: Contract,
    public extensionPO: Contract,
    public extensionCL: Contract,
    public pragma: PragmaContracts,
    public assets: Contract[],
    public deployer: Deployer,
  ) {}

  static from(contracts: ProtocolContracts, deployer: Deployer) {
    const { singleton, extensionPO, extensionCL, pragma, assets } = contracts;
    return new Protocol(singleton, extensionPO, extensionCL, pragma, assets, deployer);
  }

  async createPool(name: string, { devnetEnv = false, printParams = false } = {}) {
    let { params } = this.deployer.config.pools[name];
    if (devnetEnv) {
      params = this.patchPoolParamsWithEnv(params);
      if (printParams) {
        console.log("Pool params:");
        console.dir(params, { depth: null });
      }
    }
    return this.createPoolFromParams(params);
  }

  async createPoolFromParams(params: CreatePoolParams) {
    const { singleton, extensionPO, deployer } = this;
    const nonce = await singleton.creator_nonce(extensionPO.address);
    const poolId = await singleton.calculate_pool_id(extensionPO.address, nonce + 1n);
    assert((await singleton.extension(poolId)) === 0n, "extension should be set");

    extensionPO.connect(deployer.creator);
    const response = await extensionPO.create_pool(
      params.pool_name,
      params.asset_params,
      params.v_token_params,
      params.ltv_params,
      params.interest_rate_configs,
      params.pragma_oracle_params,
      params.liquidation_params,
      params.debt_caps_params,
      params.shutdown_params,
      params.fee_params,
      params.owner,
    );
    await deployer.waitForTransaction(response.transaction_hash);

    assert((await singleton.extension(poolId)) !== 0n, "extension should be set");
    const pool = new Pool(poolId, this, params);

    return [pool, response] as const;
  }

  async loadPool(name: string | 0) {
    const { config } = this.deployer;
    if (name === 0) {
      [name] = Object.keys(config.pools);
    }
    const poolConfig = config.pools[name];
    return new Pool(poolConfig.id, this, poolConfig.params);
  }

  patchPoolParamsWithEnv({ asset_params, fee_params, owner, ...others }: CreatePoolParams): CreatePoolParams {
    asset_params = asset_params.map(({ asset, ...rest }, index) => ({
      asset: this.assets[index].address,
      ...rest,
    }));
    fee_params = { fee_recipient: this.deployer.creator.address };
    owner = this.deployer.creator.address;
    return { asset_params, fee_params, owner, ...others };
  }
}
