import { PageSkeleton, SkeletonChips, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Cambios tardíos">
      <SkeletonChips count={3} />
      <SkeletonRows count={6} widths={[46, 30]} />
    </PageSkeleton>
  );
}
