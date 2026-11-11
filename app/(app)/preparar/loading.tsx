import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Preparar">
      <SkeletonRows count={4} widths={[48, 22]} />
    </PageSkeleton>
  );
}
