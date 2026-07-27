import { PageSkeleton, SkeletonChips, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Historial">
      <SkeletonChips count={2} />
      <SkeletonRows count={8} widths={[38, 26, 16]} />
    </PageSkeleton>
  );
}
