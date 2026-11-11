import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Dispositivos">
      <SkeletonRows count={5} widths={[40, 34]} />
    </PageSkeleton>
  );
}
