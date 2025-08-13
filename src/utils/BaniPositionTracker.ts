const baniPositionMap: Record<number, number> = {};

export const saveBaniPosition = (baniId: number, current: number) => {
  baniPositionMap[baniId] = current;
};

export const getBaniPosition = (baniId: number): number => {
  return baniPositionMap[baniId] ?? 0;
};
