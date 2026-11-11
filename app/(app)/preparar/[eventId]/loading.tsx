import { PageSkeleton, SkeletonChips, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <SkeletonChips count={3} />
      <SkeletonRows count={9} widths={[10, 56, 14]} />
    </PageSkeleton>
  );
}
