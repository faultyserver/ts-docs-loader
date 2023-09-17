type Recurser<T> = (object: T, key: string) => any;

type Walker<T, K> = (object: T, key: K, recurser: Recurser<T>) => WalkResult;

// export declare function walk<T extends object, K extends keyof T>(object: T, walkerFn: Walker<T[K], K>): WalkResult;

export declare function walk(object: any, walkerFn: (obj: any, key: string, recurse: Function) => object): object;
