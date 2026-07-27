import { PageSkeleton, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Resumen del depósito">
      <SkeletonRows count={10} widths={[36, 24, 12, 12]} />
    </PageSkeleton>
  );
}
