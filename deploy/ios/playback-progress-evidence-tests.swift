import Foundation
@main
struct EvidenceTests {
    static func main() {
        var checks = 0
        func verify(_ result: Bool, _ message: String) { checks += 1; precondition(result, message) }
        var gate = PlaybackProgressEvidence()
        func sample(_ clock: Double, _ wall: Double, playing: Bool = true, blocked: Bool = false, target: Double? = 720, rate: Double = 1) -> Bool {
            gate.observe(clock: clock, wall: wall, rate: rate, playing: playing, blocked: blocked, target: target)
        }
        verify(!sample(0,0), "old origin cannot settle target")
        verify(!sample(720,0.25), "a target jump is not playback")
        verify(!sample(720.25,0.5), "one tick is insufficient")
        verify(!sample(720.5,0.75), "two ticks are insufficient")
        verify(sample(720.75,1), "sustained playing clock settles")
        verify(sample(720.75,1.25,playing:false), "brief wait cannot flicker the settled presentation")
        verify(!sample(720.75,2,playing:false), "a genuine stall is still exposed")
        verify(!sample(721,2.25), "recovery also needs sustained evidence")
        verify(!sample(721.25,2.5), "second recovery sample")
        verify(sample(721.5,2.75), "recovery settles after real advances")
        gate.reset()
        verify(!sample(720,3), "a new seek resets old evidence")
        verify(!sample(720.25,3.25,blocked:true), "in-flight seek cannot settle")
        verify(!sample(720.5,3.5), "first sample after blocked seek")
        verify(!sample(720.75,3.75), "one advance after blocked seek")
        verify(!sample(721,4), "two advances after blocked seek")
        verify(sample(721.25,4.25), "three unblocked advances")
        gate.reset()
        verify(!sample(720,5,playing:false), "manual paused seek does not invent playback")
        verify(!sample(720,5.25,playing:false), "a paused clock remains paused")
        gate.reset()
        verify(!sample(720,6,rate:2), "2x first sample")
        verify(!sample(720.5,6.25,rate:2), "2x first advance")
        verify(!sample(721,6.5,rate:2), "2x second advance")
        verify(sample(721.5,6.75,rate:2), "2x playback is supported")
        verify(!sample(500,7), "wrong-position jump cannot keep old evidence")
        verify(!sample(.nan,7.25), "invalid clock cannot settle")
        print("PASS \(checks) progress/seek presentation checks")
    }
}
