import { PageSkeleton, SkeletonChips, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Sugerencias">
      <SkeletonChips count={2} />
      <SkeletonRows count={6} widths={[52, 20]} />
    </PageSkeleton>
  );
}
