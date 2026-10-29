import Foundation
import AVFoundation
var checks=0
func verify(_ condition: @autoclosure () -> Bool, _ description: String) { checks += 1; precondition(condition(), description) }
for bad in ["http://embed18.streamc.xyz/x","https://embed18.streamc.xyz.evil.test/x","https://user@embed18.streamc.xyz/x","https://embed18.streamc.xyz:8443/x","https://127.0.0.1/x","javascript:alert(1)"] {verify(!EmbeddedPlaybackPolicy.allows(URL(string:bad)!),"reject untrusted embedded navigation")}
verify(EmbeddedPlaybackPolicy.allows(URL(string:"https://embed18.streamc.xyz/x")!),"allow known player")
verify(EmbeddedPlaybackPolicy.isMissingSource(status:404,code:"SOURCE_NOT_FOUND"),"missing source")
verify(!EmbeddedPlaybackPolicy.isMissingSource(status:404,code:"CONTENT_NOT_FOUND"),"missing content is distinct")
for code in [401,403,429,500,503] {verify(!EmbeddedPlaybackPolicy.isMissingSource(status:code,code:"PROVIDER_UNAVAILABLE"),"network/auth failure is not a missing film")}
let decoder=NSError(domain:AVFoundationErrorDomain,code:AVError.Code.decodeFailed.rawValue)
verify(NativePlaybackFailurePolicy.isDecoderFailure(decoder),"decode error switches source")
verify(NativePlaybackFailurePolicy.isDecoderFailure(NSError(domain:AVFoundationErrorDomain,code:-11800,userInfo:[NSUnderlyingErrorKey:decoder])),"nested decoder failure")
verify(!NativePlaybackFailurePolicy.isDecoderFailure(URLError(.networkConnectionLost)),"network recovery stays separate")
verify(!NativePlaybackFailurePolicy.isDecoderFailure(NSError(domain:AVFoundationErrorDomain,code:AVError.Code.decoderTemporarilyUnavailable.rawValue)),"temporary decoder pressure is not a permanently bad source")
let hash=String(repeating:"a",count:40)
verify(NativePlaybackFailurePolicy.identity(hash+":index:7")==hash,"failed source aliases")
let list=try JSONDecoder().decode([PlaybackSourceItem].self,from:Data("""
[{"sourceToken":"\(hash):index:7","codec":"HEVC","resolution":1080,"cached":true},
{"sourceToken":"same","codec":"HEVC","resolution":1080,"cached":true},
{"sourceToken":"safe","codec":"H.264","resolution":1080,"cached":true},
{"sourceToken":"embedded:nguonc:abc","playbackType":"embedded","playable":true}]
""".utf8))
verify(NativePlaybackFailurePolicy.fallback(list,failed:[hash],current:list[0])?.sourceToken=="safe","prefer ready alternate codec")
verify(NativePlaybackFailurePolicy.fallback(list,failed:[hash,"same","safe"],current:list[0])==nil,"no native loop or embed passed into AVPlayer")
let pending=try JSONDecoder().decode(SubtitleTrackItem.self,from:Data(#"{"id":"en","language":"en","label":"English","url":null,"ready":false}"#.utf8))
verify(pending.url==nil && pending.ready==false,"pending embedded track decodes")
let legacy=try JSONDecoder().decode(SubtitleJobResult.self,from:Data(#"{"done":false,"ready":{}}"#.utf8))
verify(legacy.kind==nil && legacy.done==false,"legacy contract remains decodable")
let job=try JSONDecoder().decode(SubtitleJobResult.self,from:Data(#"{"kind":"inventory","version":2,"tracks":[],"audio":[],"done":false,"jobId":"a"}"#.utf8))
verify(job.kind=="inventory" && job.version==2,"progressive inventory contract decodes")
let request=SourcesRequest(type:"movie",tmdbId:1469229,season:nil,episode:nil,capabilities:.current)
let payload=try JSONSerialization.jsonObject(with:JSONEncoder().encode(request)) as! [String:Any]
verify(payload["embeddedPlayer"] as? Bool==true,"new client explicitly opts in")
print("PASS \(checks) native policy and API contract checks")
