import { PageSkeleton, SkeletonChips, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Inventario">
      <SkeletonChips count={4} />
      <SkeletonRows count={10} widths={[40, 20, 14, 12]} />
    </PageSkeleton>
  );
}
