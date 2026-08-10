import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Qué cambió">
      <SkeletonRows count={5} widths={[34, 16, 12, 12]} />
    </PageSkeleton>
  );
}
