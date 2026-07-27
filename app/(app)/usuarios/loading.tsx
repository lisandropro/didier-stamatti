import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Usuarios">
      <SkeletonRows count={3} widths={[34, 30, 16]} />
    </PageSkeleton>
  );
}
