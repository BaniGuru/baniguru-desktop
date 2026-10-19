/// ONNX's pool setting does not cover the caller when inference uses one
/// thread. Scope denormal flushing to this synchronous ASR call and restore
/// the Tokio worker's original floating-point mode before returning.
pub(super) struct CpuFloatMode {
    #[cfg(target_arch = "x86_64")]
    previous: u32,
}

impl CpuFloatMode {
    #[allow(deprecated)]
    pub fn enter() -> Self {
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let previous = std::arch::x86_64::_mm_getcsr();
            std::arch::x86_64::_mm_setcsr(previous | 0x8040);
            Self { previous }
        }
        #[cfg(not(target_arch = "x86_64"))]
        Self {}
    }
}

impl Drop for CpuFloatMode {
    #[allow(deprecated)]
    fn drop(&mut self) {
        #[cfg(target_arch = "x86_64")]
        unsafe {
            std::arch::x86_64::_mm_setcsr(self.previous);
        }
    }
}

#[cfg(all(test, target_arch = "x86_64"))]
mod tests {
    use super::*;

    #[test]
    #[allow(deprecated)]
    fn restores_the_calling_workers_float_mode() {
        unsafe {
            let before = std::arch::x86_64::_mm_getcsr();
            {
                let _mode = CpuFloatMode::enter();
                assert_eq!(std::arch::x86_64::_mm_getcsr() & 0x8040, 0x8040);
            }
            assert_eq!(std::arch::x86_64::_mm_getcsr(), before);
        }
    }
}
