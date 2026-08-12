export type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;

export type Expect<T extends true> = T;

export type IsAny<T> = 0 extends 1 & T ? true : false;
