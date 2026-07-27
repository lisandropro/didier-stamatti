import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Avisos">
      <SkeletonRows count={6} widths={[52, 20]} />
    </PageSkeleton>
  );
}
