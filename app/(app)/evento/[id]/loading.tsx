import { PageSkeleton, SkeletonChips, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  // Sin título fijo: el encabezado real es el lugar del evento.
  return (
    <PageSkeleton>
      <SkeletonChips count={4} />
      <SkeletonRows count={10} widths={[42, 26, 16]} />
    </PageSkeleton>
  );
}
