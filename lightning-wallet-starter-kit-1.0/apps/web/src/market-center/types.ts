export type MarketChain='EVM'|'SOL'|'TRON';
export type MarketToken={chain:MarketChain;address:string;name:string;symbol:string;quoteSymbol:string;pairAddress:string;dexId:string;url:string;priceUsd:number|null;marketCap:number|null;fdv:number|null;liquidityUsd:number|null;volume24h:number|null;priceChange24h:number|null;buys24h:number|null;sells24h:number|null;updatedAt:string;readOnly:true;holders?:{status:'available'|'unavailable';holderCount:number|null;topHolders:{address:string;balance:string;sharePct:number|null}[]}};
export type Candle={time:number;open:number|null;high:number|null;low:number|null;close:number;volume:number|null};
export type MarketTrade={id:string;side:string;priceUsd:number|null;volumeUsd:number|null;txHash:string;time:string};
export type WatchItem=Pick<MarketToken,'chain'|'address'|'name'|'symbol'>;
export type PriceAlert={id:string;chain:MarketChain;address:string;symbol:string;direction:'above'|'below';target:number;createdAt:string};
