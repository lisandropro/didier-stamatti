import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton>
      <SkeletonRows count={4} widths={[70, 16]} />
    </PageSkeleton>
  );
}
